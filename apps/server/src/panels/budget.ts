import { budgetAvailable } from "../budget/gate";
import { computeRollup, monthKey } from "../budget/rollup";
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
    const rollup = computeRollup(ctx.budget, ctx.cfg, month);
    json(200, {
      month,
      netWorthCents: nw.totalCents,
      equityLabel: "Equity coming soon",
      cashFlowCents: rollup.cashFlowCents,
      incomeCents: rollup.incomeCents,
      spendCents: rollup.spendCents,
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
  var sign=n<0?"-":"";
  return sign+"$"+(Math.abs(n)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
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
