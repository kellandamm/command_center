import { budgetAvailable } from "../budget/gate";
import { monthKey } from "../budget/rollup";
import { panelCard } from "../ui/components";
import type { PanelModule } from "./types";

export const BUDGET_PANEL_ID = "budget";
export const BUDGET_AMOUNTS_BLUR_CLASS = "budget-amount-blur";
export const BUDGET_REVEAL_STORAGE_KEY = "cc-budget-panel-reveal";

export const budgetPanel: PanelModule = {
  id: BUDGET_PANEL_ID,
  title: "Budget",
  pageHref: "/budget",
  dashboardHtml: panelCard("panel-budget", `
  <div class="budget-panel-head row" style="justify-content:space-between;align-items:center;margin-bottom:.35rem">
    <p class="dim" style="margin:0;font-size:.8125rem" id="budget-panel-month"></p>
    <button type="button" class="ghost btn-sm" id="budget-panel-reveal" aria-pressed="false" aria-label="Show amounts">Show</button>
  </div>
  <p class="budget-panel-net tabular-nums ${BUDGET_AMOUNTS_BLUR_CLASS}" id="budget-panel-net">—</p>
  <p class="dim" style="margin:.15rem 0;font-size:.75rem" id="budget-panel-equity">Equity coming soon</p>
  <p class="dim tabular-nums ${BUDGET_AMOUNTS_BLUR_CLASS}" id="budget-panel-cashflow" style="margin:0;font-size:.8125rem"></p>`),
  async handle(ctx, req, res, path) {
    if (path !== "/api/panels/budget" || req.method !== "GET") return false;
    if (!budgetAvailable(ctx.cfg) || !ctx.owner || !ctx.budget) {
      return false;
    }
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    const month = monthKey(new Date(), ctx.cfg.tz);
    const nw = ctx.budget.netWorth();
    const txs = ctx.budget.listTransactions(undefined, 5000);
    let income = 0;
    let spend = 0;
    const groups = ctx.budget.listCategoryGroups();
    const incomeGroupIds = new Set(groups.filter((g) => g.isIncome).map((g) => g.id));
    const cats = ctx.budget.listCategories();
    const incomeCatIds = new Set(cats.filter((c) => incomeGroupIds.has(c.groupId)).map((c) => c.id));
    for (const tx of txs) {
      if (tx.transferAccountId || !tx.date.startsWith(month)) continue;
      if (tx.categoryId && incomeCatIds.has(tx.categoryId)) income += tx.amountCents;
      else if (tx.amountCents < 0) spend += tx.amountCents;
    }
    json(200, {
      month,
      netWorthCents: nw.totalCents,
      equityLabel: "Equity coming soon",
      cashFlowCents: income + spend,
      incomeCents: income,
      spendCents: spend,
    });
    return true;
  },
};

export function budgetDashboardScript(): string {
  return `
function budgetPanelRevealOn(){
  try{return localStorage.getItem(${JSON.stringify(BUDGET_REVEAL_STORAGE_KEY)})==="1";}catch(e){return false;}
}
function budgetPanelApplyReveal(on){
  document.querySelectorAll(".${BUDGET_AMOUNTS_BLUR_CLASS}").forEach(function(el){
    el.classList.toggle("is-revealed",!!on);
  });
  var btn=document.getElementById("budget-panel-reveal");
  if(btn){
    btn.setAttribute("aria-pressed",on?"true":"false");
    btn.textContent=on?"Hide":"Show";
    btn.setAttribute("aria-label",on?"Hide amounts":"Show amounts");
  }
}
function fmtBudget(cents){
  var n=Number(cents)||0;
  return (n<0?"-":"")+"$"+(Math.abs(n)/100).toFixed(2);
}
function renderBudgetPanel(d){
  var net=document.getElementById("budget-panel-net");
  var eq=document.getElementById("budget-panel-equity");
  var cf=document.getElementById("budget-panel-cashflow");
  var mo=document.getElementById("budget-panel-month");
  if(mo)mo.textContent=d.month?"Month "+d.month:"";
  if(net)net.textContent=fmtBudget(d.netWorthCents);
  if(eq)eq.textContent=d.equityLabel||"Equity coming soon";
  if(cf)cf.textContent="Cash flow "+fmtBudget(d.cashFlowCents);
  budgetPanelApplyReveal(budgetPanelRevealOn());
}
function loadBudgetPanel(){
  if(!document.getElementById("panel-budget"))return Promise.resolve();
  return api("/api/panels/budget").then(renderBudgetPanel).catch(function(){});
}
document.getElementById("budget-panel-reveal")?.addEventListener("click",function(){
  var on=!budgetPanelRevealOn();
  try{localStorage.setItem(${JSON.stringify(BUDGET_REVEAL_STORAGE_KEY)},on?"1":"0");}catch(e){}
  budgetPanelApplyReveal(on);
});
loadBudgetPanel();
`;
}

export function budgetPanelDashboardCss(): string {
  return `
.${BUDGET_AMOUNTS_BLUR_CLASS}{filter:blur(6px);user-select:none;transition:filter .15s ease}
.${BUDGET_AMOUNTS_BLUR_CLASS}.is-revealed{filter:none;user-select:text}
.budget-panel-net{font-size:1.35rem;font-weight:600;margin:0}
`;
}
