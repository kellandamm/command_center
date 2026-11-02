import type { NavLink } from "./layout";
import { button, emptyState, field, pageHeader, skeleton, statCard, statGrid, tabs } from "./components";
import { page } from "./layout";

const VIEW_LINKS = [
  { id: "overview", label: "Overview", href: "/budget" },
  { id: "transactions", label: "Transactions", href: "/budget?view=transactions" },
  { id: "budget", label: "Budget", href: "/budget?view=budget" },
  { id: "subscriptions", label: "Subscriptions", href: "/budget?view=subscriptions" },
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
  const initialView = opts.initialView ?? "overview";
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

  const accountsEmpty = emptyState({
    title: "No accounts yet",
    description: "Add an account, then import a CSV from your bank.",
    actionHtml: button({ label: "Add account", attrs: { id: "budget-add-account", type: "button" } }),
  });

  const overviewShell = `${statGrid(
    statCard({ label: "Net worth", value: "—", hint: "Equity coming soon" }) +
      statCard({ label: "Income", value: "—" }) +
      statCard({ label: "Spending", value: "—" }) +
      statCard({ label: "Cash flow", value: "—" }),
  )}
<div id="budget-overview-categories" class="card card-sm" style="margin-top:1rem">${skeleton({ lines: 4 })}</div>`;

  const body = `${pageHeader({ title: "Budget", description: "CSV import, accounts, and monthly views (owner-only)." })}
${viewTabs(initialView === "overview" ? "overview" : initialView)}
<div id="budget-status" class="workspace-status" role="status"></div>
<section id="budget-panel-overview" class="budget-panel" hidden>${overviewShell}</section>
<section id="budget-panel-transactions" class="budget-panel" hidden>
<div class="card card-sm"><div id="budget-tx-list">${skeleton({ lines: 5 })}</div></div>
</section>
<section id="budget-panel-budget" class="budget-panel" hidden>
<div class="row" style="margin-bottom:.75rem;align-items:center;gap:.5rem">
<label class="dim" for="budget-month-picker">Month</label>
<input id="budget-month-picker" type="month" />
</div>
<div id="budget-month-grid" class="card card-sm">${skeleton({ lines: 6 })}</div>
</section>
<section id="budget-panel-subscriptions" class="budget-panel" hidden>
<style>.budget-sub-actions{white-space:nowrap;display:inline-flex;gap:.35rem;flex-wrap:nowrap}.budget-sub-next-due{white-space:nowrap}</style>
<div class="row" style="margin-bottom:.75rem;gap:.5rem;flex-wrap:wrap;align-items:center">
${button({ label: "Scan for subscriptions", attrs: { id: "budget-sub-scan", type: "button" } })}
${button({ label: "Add manual", variant: "secondary", attrs: { id: "budget-sub-add", type: "button" } })}
</div>
<div id="budget-sub-stats" class="stat-grid" style="margin-bottom:1rem">${statCard({ label: "Annual recurring", value: "—" })}${statCard({ label: "Active", value: "—" })}</div>
<div id="budget-sub-detections" class="card card-sm" style="margin-bottom:1rem">${skeleton({ lines: 3 })}</div>
<div id="budget-sub-active" class="card card-sm">${skeleton({ lines: 4 })}</div>
</section>
<section id="budget-panel-accounts" class="budget-panel">${accountsEmpty}</section>
<section id="budget-panel-import" class="budget-panel" hidden>
${cardImportWizard()}
</section>
<section id="budget-panel-settings" class="budget-panel" hidden>
<div class="card card-sm">
<p class="dim">Export a backup or remove all budget data from this server.</p>
<div class="row" style="margin:.75rem 0">${button({ label: "Export JSON", attrs: { id: "budget-export-json", type: "button" } })}${button({
    label: "Export CSV",
    variant: "secondary",
    attrs: { id: "budget-export-csv", type: "button" },
  })}</div>
${field({
  label: "Privacy",
  id: "budget-over-notify",
  hint: "Over-budget phone notifications are not available in v1; leave off.",
  inputHtml: '<label><input type="checkbox" id="budget-over-notify" disabled> Over-budget notifications (coming later)</label>',
})}
<hr style="border:0;border-top:1px solid var(--border);margin:1rem 0" />
<p class="dim">Type <strong>DELETE ALL BUDGET DATA</strong> to erase accounts, transactions, and budgets.</p>
<input id="budget-delete-confirm" type="text" autocomplete="off" placeholder="DELETE ALL BUDGET DATA" style="width:100%;max-width:24rem;margin:.5rem 0" />
${button({ label: "Delete all budget data", variant: "secondary", attrs: { id: "budget-delete-all", type: "button" } })}
</div>
</section>
<script>
(function(){
var params=new URLSearchParams(location.search);
var view=params.get("view")||"overview";
var panels={overview:"overview",transactions:"transactions",budget:"budget",subscriptions:"subscriptions",accounts:"accounts",import:"import",settings:"settings"};
var active=panels[view]?view:"overview";
document.querySelectorAll(".ui-tabs a").forEach(function(a){
  var href=a.getAttribute("href")||"";
  var match=href==="/budget"?"overview":(href.split("view=")[1]||"");
  a.setAttribute("aria-current",match===active?"page":"false");
});
["overview","transactions","budget","subscriptions","accounts","import","settings"].forEach(function(id){
  var el=document.getElementById("budget-panel-"+id);
  if(el)el.hidden=(active!==id);
});
function api(path,method,body){
  return fetch(path,{method:method||"GET",headers:{"content-type":"application/json","x-ah":"1"},body:body?JSON.stringify(body):undefined}).then(function(r){
    return r.json().then(function(j){if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j;});
  });
}
function fmt(cents){var n=Number(cents)||0;var sign=n<0?"-":"";return sign+"$"+(Math.abs(n)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});}
function setStatus(msg,bad){var el=document.getElementById("budget-status");if(!el)return;el.textContent=msg||"";el.classList.toggle("bad",!!bad);}
function textCell(tr,text){var td=document.createElement("td");td.textContent=text;tr.appendChild(td);}
var state={accounts:[],categories:[],groups:[],preview:null,dateFormatTouched:false,rollup:null,month:"",subscriptions:null};
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
    var bal=a.balanceCents!=null?a.balanceCents:(a.type==="investment"?(a.currentBalanceCents||0):a.openingBalanceCents);
    var tdBal=document.createElement("td");tdBal.className="tabular-nums";tdBal.textContent=fmt(bal);tr.appendChild(tdBal);
    var tdAct=document.createElement("td");
    var imp=document.createElement("button");imp.type="button";imp.className="ghost btn-sm";imp.textContent="Import";
    if(a.type==="investment")imp.disabled=true;
    imp.onclick=function(){location.href="/budget?view=import&account="+a.id;};
    tdAct.appendChild(imp);tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);box.appendChild(table);
}
function renderOverview(){
  var grid=document.querySelector("#budget-panel-overview .stat-grid");
  if(!grid||!state.rollup)return;
  var r=state.rollup;
  var cards=grid.querySelectorAll(".stat-card");
  if(cards[0]){cards[0].querySelector(".stat-value").textContent=state.netWorth!=null?fmt(state.netWorth):"—";}
  if(cards[1])cards[1].querySelector(".stat-value").textContent=fmt(r.incomeCents);
  if(cards[2])cards[2].querySelector(".stat-value").textContent=fmt(r.spendCents);
  if(cards[3])cards[3].querySelector(".stat-value").textContent=fmt(r.cashFlowCents);
  var box=document.getElementById("budget-overview-categories");
  if(!box)return;
  box.replaceChildren();
  var h=document.createElement("h3");h.style.marginTop="0";h.textContent="Top categories";box.appendChild(h);
  if(!r.topCategories||!r.topCategories.length){box.appendChild(document.createElement("p")).textContent="No spending this month.";return;}
  var table=document.createElement("table");table.className="ui-table";
  var thead=document.createElement("thead");var hr=document.createElement("tr");
  ["Category","Spent","Budget"].forEach(function(x){var th=document.createElement("th");th.textContent=x;hr.appendChild(th);});
  thead.appendChild(hr);table.appendChild(thead);
  var tbody=document.createElement("tbody");
  r.topCategories.forEach(function(row){
    var tr=document.createElement("tr");
    textCell(tr,row.categoryName||"Uncategorized");
    textCell(tr,fmt(row.spentCents));
    textCell(tr,fmt(row.budgetedCents));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);box.appendChild(table);
}
function renderTransactions(){
  var box=document.getElementById("budget-tx-list");
  if(!box)return;
  box.replaceChildren();
  if(!state.transactions||!state.transactions.length){
    box.innerHTML='<div class="ui-empty" role="status"><p class="ui-empty-title">No transactions yet.</p></div>';
    return;
  }
  var table=document.createElement("table");table.className="ui-table";
  var thead=document.createElement("thead");var hr=document.createElement("tr");
  ["Date","Payee","Amount","Category"].forEach(function(h){var th=document.createElement("th");th.textContent=h;hr.appendChild(th);});
  thead.appendChild(hr);table.appendChild(thead);
  var tbody=document.createElement("tbody");
  var catName=function(id){var c=state.categories.find(function(x){return x.id===id;});return c?c.name:"";};
  state.transactions.forEach(function(tx){
    var tr=document.createElement("tr");
    textCell(tr,tx.date);textCell(tr,tx.payee||"");
    var tdAmt=document.createElement("td");tdAmt.className="tabular-nums";tdAmt.textContent=fmt(tx.amountCents);tr.appendChild(tdAmt);
    textCell(tr,catName(tx.categoryId));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);box.appendChild(table);
}
function renderBudgetMonth(){
  var box=document.getElementById("budget-month-grid");
  if(!box||!state.rollup)return;
  box.replaceChildren();
  var table=document.createElement("table");table.className="ui-table";
  var thead=document.createElement("thead");var hr=document.createElement("tr");
  ["Category","Budgeted","Spent","Left"].forEach(function(h){var th=document.createElement("th");th.textContent=h;hr.appendChild(th);});
  thead.appendChild(hr);table.appendChild(thead);
  var tbody=document.createElement("tbody");
  state.rollup.byCategory.filter(function(row){return !row.isIncome&&row.categoryId;}).forEach(function(row){
    var left=row.budgetedCents+row.spentCents;
    var tr=document.createElement("tr");
    textCell(tr,row.categoryName||"Uncategorized");
    var tdB=document.createElement("td");tdB.className="tabular-nums";
    var inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="0.01";inp.value=(row.budgetedCents/100).toFixed(2);
    inp.dataset.categoryId=row.categoryId;inp.className="tabular-nums";inp.style.width="6rem";
    inp.onchange=function(){
      var cents=Math.round(Number(inp.value)*100)||0;
      api("/api/budget/budget-months","PUT",{month:state.month,categoryId:row.categoryId,budgetedCents:cents}).then(loadRollup).catch(function(e){setStatus(e.message,true);});
    };
    tdB.appendChild(inp);tr.appendChild(tdB);
    var tdS=document.createElement("td");tdS.className="tabular-nums";tdS.textContent=fmt(row.spentCents);tr.appendChild(tdS);
    var tdL=document.createElement("td");tdL.className="tabular-nums";tdL.textContent=fmt(left);
    if(row.budgetedCents>0&&left<0)tdL.style.color="var(--warning)";
    tr.appendChild(tdL);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);box.appendChild(table);
}
function openAccountDialog(){
  var name=prompt("Account name"); if(!name)return;
  var type=(prompt("Type: checking, savings, credit, cash, investment","checking")||"checking").trim();
  api("/api/budget/accounts","POST",{name:name,type:type}).then(loadAccounts).catch(function(e){setStatus(e.message,true);});
}
function loadAccounts(){return api("/api/budget/accounts").then(function(r){state.accounts=r.accounts;renderAccounts();if(active==="import")fillImportAccounts();}).catch(function(e){setStatus(e.message,true);});}
function loadCategories(){return api("/api/budget/categories").then(function(r){state.categories=r.categories;state.groups=r.groups;}).catch(function(){});}
function loadRollup(){
  var picker=document.getElementById("budget-month-picker");
  var month=picker&&picker.value?picker.value:state.month;
  if(!month){var d=new Date();month=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
  state.month=month;
  return api("/api/budget/rollup?month="+encodeURIComponent(month)).then(function(r){state.rollup=r.rollup;renderOverview();renderBudgetMonth();}).catch(function(e){setStatus(e.message,true);});
}
function loadNetWorth(){return api("/api/budget/net-worth").then(function(r){state.netWorth=r.totalCents;renderOverview();}).catch(function(){});}
function loadTransactions(){return api("/api/budget/transactions").then(function(r){state.transactions=r.transactions;renderTransactions();}).catch(function(e){setStatus(e.message,true);});}
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
    setStatus("Import complete.");state.preview=null;loadAccounts();loadRollup();loadTransactions();
  }).catch(function(e){setStatus(e.message,true);});
}
document.getElementById("budget-preview-btn")?.addEventListener("click",runPreview);
document.getElementById("budget-commit-btn")?.addEventListener("click",commitImport);
document.getElementById("budget-date-format")?.addEventListener("change",function(){state.dateFormatTouched=true;});
document.getElementById("budget-export-json")?.addEventListener("click",function(){window.location.href="/api/budget/export.json";});
document.getElementById("budget-export-csv")?.addEventListener("click",function(){window.location.href="/api/budget/export.csv";});
document.getElementById("budget-delete-all")?.addEventListener("click",function(){
  var v=document.getElementById("budget-delete-confirm")?.value||"";
  if(v!=="DELETE ALL BUDGET DATA"){setStatus("Type the confirmation phrase exactly.",true);return;}
  api("/api/budget/delete-all","POST",{confirm:v}).then(function(){setStatus("All budget data deleted.");loadAccounts();loadRollup();loadTransactions();loadSubscriptions();}).catch(function(e){setStatus(e.message,true);});
});
function renderSubscriptions(){
  var data=state.subscriptions;if(!data)return;
  var stats=document.getElementById("budget-sub-stats");
  if(stats){
    var cards=stats.querySelectorAll(".stat-card");
    var total=data.subscriptions.reduce(function(s,x){return s+(x.annualCostCents||0);},0);
    if(cards[0])cards[0].querySelector(".stat-value").textContent=fmt(-total);
    if(cards[1])cards[1].querySelector(".stat-value").textContent=String(data.subscriptions.length);
  }
  var detBox=document.getElementById("budget-sub-detections");
  if(detBox){
    detBox.replaceChildren();
    var h=document.createElement("h3");h.style.marginTop="0";h.textContent="Pending detections";detBox.appendChild(h);
    if(!data.detections.length){detBox.appendChild(document.createElement("p")).textContent="No pending detections.";detBox.lastChild.className="dim";}
    else{
      var table=document.createElement("table");table.className="ui-table";
      var thead=document.createElement("thead");var hr=document.createElement("tr");
      ["Payee","Amount","Cadence","Confidence",""].forEach(function(x){var th=document.createElement("th");th.textContent=x;hr.appendChild(th);});
      thead.appendChild(hr);table.appendChild(thead);
      var tbody=document.createElement("tbody");
      data.detections.forEach(function(d){
        var tr=document.createElement("tr");
        var tdName=document.createElement("td");
        tdName.textContent=d.displayName||d.payeeNormalized;
        if(d.detectionKind==="possible_yearly"){
          var badge=document.createElement("span");badge.className="ui-badge ui-badge-warning";badge.style.marginLeft=".5rem";badge.textContent="Possible yearly — please confirm";
          tdName.appendChild(badge);
        }
        tr.appendChild(tdName);
        textCell(tr,fmt(d.amountCents));textCell(tr,d.cadence);textCell(tr,(Math.round(d.confidence*100))+"%");
        var tdAct=document.createElement("td");
        var cBtn=document.createElement("button");cBtn.type="button";cBtn.className="btn btn-sm";cBtn.textContent="Confirm";
        cBtn.onclick=function(){confirmDetection(d);};
        var dBtn=document.createElement("button");dBtn.type="button";dBtn.className="ghost btn-sm";dBtn.textContent="Dismiss";
        dBtn.onclick=function(){dismissDetection(d.id);};
        tdAct.appendChild(cBtn);tdAct.appendChild(dBtn);tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);detBox.appendChild(table);
    }
  }
  var actBox=document.getElementById("budget-sub-active");
  if(actBox){
    actBox.replaceChildren();
    var h2=document.createElement("h3");h2.style.marginTop="0";h2.textContent="Active subscriptions";actBox.appendChild(h2);
    if(!data.subscriptions.length){actBox.appendChild(document.createElement("p")).textContent="No subscriptions yet.";actBox.lastChild.className="dim";}
    else{
      var table2=document.createElement("table");table2.className="ui-table";
      var thead2=document.createElement("thead");var hr2=document.createElement("tr");
      ["Name","Amount","Cadence","Annual","Next due","Category",""].forEach(function(x){var th=document.createElement("th");th.textContent=x;hr2.appendChild(th);});
      thead2.appendChild(hr2);table2.appendChild(thead2);
      var tbody2=document.createElement("tbody");
      var catName=function(id){var c=state.categories.find(function(x){return x.id===id;});return c?c.name:"";};
      data.subscriptions.forEach(function(s){
        var tr=document.createElement("tr");
        textCell(tr,s.displayName);textCell(tr,fmt(s.amountCents));textCell(tr,s.cadence);
        textCell(tr,fmt(-s.annualCostCents));
        var tdDue=document.createElement("td");tdDue.className="budget-sub-next-due";tdDue.textContent=s.nextDueDate||"—";tr.appendChild(tdDue);
        textCell(tr,catName(s.categoryId));
        var tdAct=document.createElement("td");tdAct.className="budget-sub-actions";
        var editBtn=document.createElement("button");editBtn.type="button";editBtn.className="ghost btn-sm";editBtn.textContent="Edit";
        editBtn.onclick=function(){editSubscription(s);};
        var offBtn=document.createElement("button");offBtn.type="button";offBtn.className="ghost btn-sm";offBtn.textContent="Deactivate";
        offBtn.onclick=function(){deactivateSubscription(s.id);};
        tdAct.appendChild(editBtn);tdAct.appendChild(offBtn);tr.appendChild(tdAct);
        tbody2.appendChild(tr);
      });
      table2.appendChild(tbody2);actBox.appendChild(table2);
    }
  }
}
function loadSubscriptions(){return api("/api/budget/subscriptions").then(function(r){state.subscriptions=r;renderSubscriptions();}).catch(function(e){setStatus(e.message,true);});}
function activeSubscriptionRows(){
  var data=state.subscriptions;
  return data&&Array.isArray(data.subscriptions)?data.subscriptions:[];
}
function confirmDetection(d){
  var catOpts=state.categories.filter(function(c){return !state.groups.find(function(g){return g.id===c.groupId&&g.isIncome;});});
  var names=catOpts.map(function(c,i){return (i+1)+") "+c.name;}).join("\\n");
  var pick=prompt("Pick category number:\\n"+names);
  if(!pick)return;
  var idx=Number(pick)-1;if(idx<0||idx>=catOpts.length){setStatus("Invalid category.",true);return;}
  var cadence=(prompt("Cadence: weekly, monthly, yearly",d.cadence)||d.cadence).trim();
  var deactivateConflicting=false;
  var hasConflict=!!d.hasConflictingActiveSubscription&&cadence===d.cadence;
  if(hasConflict){
    deactivateConflicting=confirm("An active subscription exists for this payee at a different amount.\\n\\nOK — deactivate the older one and confirm this price.\\nCancel — keep both subscriptions active (annual totals may double-count).");
  }
  api("/api/budget/subscriptions/detections/"+encodeURIComponent(d.id)+"/confirm","POST",{categoryId:catOpts[idx].id,cadence:cadence,deactivateConflictingActive:deactivateConflicting}).then(function(){setStatus("Subscription confirmed.");loadSubscriptions();}).catch(function(e){setStatus(e.message,true);});
}
function dismissDetection(id){
  api("/api/budget/subscriptions/detections/"+encodeURIComponent(id)+"/dismiss","POST",{}).then(function(){loadSubscriptions();}).catch(function(e){setStatus(e.message,true);});
}
document.getElementById("budget-sub-scan")?.addEventListener("click",function(){
  api("/api/budget/subscriptions/scan","POST",{}).then(function(r){setStatus("Scan complete. New detections: "+r.inserted);loadSubscriptions();}).catch(function(e){setStatus(e.message,true);});
});
function localDateIso(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function editSubscription(s){
  var amt=prompt("Amount (dollars, outflow)",String(Math.abs(s.amountCents)/100));if(amt==null)return;
  var cents=-Math.round(Number(amt)*100);if(!cents){setStatus("Invalid amount.",true);return;}
  var cadence=(prompt("Cadence: weekly, monthly, yearly",s.cadence)||s.cadence).trim();
  var anchor=prompt("Anchor date (YYYY-MM-DD)",s.anchorDate)||s.anchorDate;
  api("/api/budget/subscriptions/"+encodeURIComponent(s.id),"PUT",{amountCents:cents,cadence:cadence,anchorDate:anchor}).then(function(){loadSubscriptions();}).catch(function(e){setStatus(e.message,true);});
}
function deactivateSubscription(id){
  if(!confirm("Deactivate this subscription?"))return;
  api("/api/budget/subscriptions/"+encodeURIComponent(id),"PUT",{active:false}).then(function(){loadSubscriptions();}).catch(function(e){setStatus(e.message,true);});
}
document.getElementById("budget-sub-add")?.addEventListener("click",function(){
  var name=prompt("Display name");if(!name)return;
  var payee=prompt("Bank payee (for matching imports)",name)||name;
  var cadence=(prompt("Cadence: weekly, monthly, yearly","monthly")||"monthly").trim();
  var amtLabel=cadence==="yearly"?"Yearly amount (dollars, outflow)":cadence==="weekly"?"Weekly amount (dollars, outflow)":"Monthly amount (dollars, outflow)";
  var amt=prompt(amtLabel,"9.99");if(!amt)return;
  var cents=-Math.round(Number(amt)*100);if(!cents){setStatus("Invalid amount.",true);return;}
  var catOpts=state.categories.filter(function(c){return !state.groups.find(function(g){return g.id===c.groupId&&g.isIncome;});});
  var pick=prompt("Category number:\\n"+catOpts.map(function(c,i){return (i+1)+") "+c.name;}).join("\\n"));
  if(!pick)return;
  var idx=Number(pick)-1;
  if(idx<0||idx>=catOpts.length){setStatus("Invalid category.",true);return;}
  api("/api/budget/subscriptions","POST",{displayName:name,payee:payee,amountCents:cents,cadence:cadence,categoryId:catOpts[idx].id,anchorDate:localDateIso()}).then(function(){loadSubscriptions();}).catch(function(e){setStatus(e.message,true);});
});
var monthPicker=document.getElementById("budget-month-picker");
if(monthPicker){
  var d=new Date();monthPicker.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  monthPicker.addEventListener("change",loadRollup);
}
loadCategories().then(function(){
  loadAccounts();
  if(active==="overview"){loadNetWorth().then(loadRollup);}
  if(active==="transactions")loadTransactions();
  if(active==="budget")loadRollup();
  if(active==="subscriptions")loadSubscriptions();
  if(active==="import")fillImportAccounts();
});
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
