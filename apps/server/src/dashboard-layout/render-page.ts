import type { CalendarEvent } from "../calendar/parse-ics";
import type { Config } from "../config";
import { panelById, panels } from "../panels/registry";
import type { ServiceCheckResult } from "../service-status/checks";
import { esc } from "../ui/layout";
import { button } from "../ui/components";
import { renderAgentJobsWidget } from "../widgets/agent-jobs";
import { renderCountdownWidget } from "../widgets/countdown";
import { renderServiceStatusWidget } from "../widgets/service-status";
import { renderTodayAgendaWidget } from "../widgets/today-agenda";
import { renderWorldClockWidget } from "../widgets/world-clock";
import type { DashboardLayout, PanelLayoutEntry } from "./types";
import { catalogWidgets, widgetById, type WidgetDefinition } from "./widgets";

export interface DashboardRenderContext {
  cfg: Config;
  layout: DashboardLayout;
  showBudgetPanel: boolean;
  calendarEvents: CalendarEvent[];
  serviceStatus: ServiceCheckResult[];
  now?: Date;
}

function statusDotClass(dot: WidgetDefinition["statusDot"]): string {
  return `dashboard-status-dot dashboard-status-dot--${dot}`;
}

function widgetBody(ctx: DashboardRenderContext, entry: PanelLayoutEntry): string {
  const def = widgetById(entry.id);
  if (!def) return `<p class="dim">Unknown widget</p>`;
  if (def.kind === "panel" && def.panelId) {
    const panel = panelById(def.panelId);
    if (!panel) return `<p class="dim">Panel unavailable</p>`;
    return panel.dashboardHtml;
  }
  const now = ctx.now ?? new Date();
  switch (entry.id) {
    case "today-agenda":
      return renderTodayAgendaWidget(ctx.calendarEvents, ctx.cfg.tz, now);
    case "agent-jobs":
      return renderAgentJobsWidget();
    case "service-status":
      return renderServiceStatusWidget(ctx.serviceStatus);
    case "countdown":
      return renderCountdownWidget(entry.config, now);
    case "world-clock":
      return renderWorldClockWidget(entry.config, now);
    default:
      return `<p class="dim">Widget not available</p>`;
  }
}

function cardChrome(def: WidgetDefinition, size: string): string {
  const tag = def.category.toUpperCase();
  return `<div class="dashboard-widget-chrome">
  <button type="button" class="dashboard-drag-handle dashboard-edit-only" tabindex="0" aria-label="Drag ${esc(def.title)}">⠿</button>
  <span class="${statusDotClass(def.statusDot)}" aria-hidden="true"></span>
  <h2>${esc(def.title)}</h2>
  <span class="dashboard-category-tag">${esc(tag)}</span>
  <div class="dashboard-size-toggle dashboard-edit-only" role="group" aria-label="Card size">
    ${(["S", "W", "L", "XL"] as const)
      .map((s) => `<button type="button" class="dashboard-size-btn${s === size ? " is-active" : ""}" data-size="${s}">${s}</button>`)
      .join("")}
  </div>
  <button type="button" class="dashboard-remove dashboard-edit-only" aria-label="Remove ${esc(def.title)}">×</button>
  <details class="dashboard-card-menu dashboard-view-only">
    <summary class="dashboard-card-menu-btn" aria-label="Widget menu">⋯</summary>
    <div class="dashboard-card-menu-panel">
      <button type="button" class="btn btn-outline btn-sm dashboard-menu-resize" data-size="S">Size S</button>
      <button type="button" class="btn btn-outline btn-sm dashboard-menu-resize" data-size="W">Size W</button>
      <button type="button" class="btn btn-outline btn-sm dashboard-menu-resize" data-size="L">Size L</button>
      <button type="button" class="btn btn-outline btn-sm dashboard-menu-resize" data-size="XL">Size XL</button>
    </div>
  </details>
</div>`;
}

export function renderDashboardGrid(ctx: DashboardRenderContext): string {
  const items = ctx.layout.panels
    .map((entry) => {
      const def = widgetById(entry.id);
      if (!def) return "";
      if (def.id === "budget" && !ctx.showBudgetPanel) return "";
      return `<div class="dashboard-item" data-widget-id="${esc(entry.id)}" data-panel-id="${esc(def.panelId ?? entry.id)}" data-size="${entry.size}"
  style="--gc-start:${entry.x + 1};--gc-span:${entry.w};--gr-start:${entry.y + 1};--gr-span:${entry.h}">
  <section class="card">
  ${cardChrome(def, entry.size)}
  <div class="dashboard-panel-body">${widgetBody(ctx, entry)}</div>
  </section>
</div>`;
    })
    .filter(Boolean)
    .join("\n");
  return items;
}

export function renderWidgetDrawer(ctx: DashboardRenderContext): string {
  const onGrid = new Set(ctx.layout.widgets.map((w) => w.id));
  const catalog = catalogWidgets({ showBudget: ctx.showBudgetPanel });
  const items = catalog
    .map(
      (w) => `<button type="button" class="dashboard-drawer-item" data-add-widget="${esc(w.id)}" data-default-size="${w.defaultSize}"${onGrid.has(w.id) ? " hidden" : ""}>
  <span class="dashboard-drawer-icon" aria-hidden="true">+</span>
  <span><strong>${esc(w.title)}</strong><span class="dim"> · ${esc(w.defaultSize)}</span></span>
</button>`,
    )
    .join("");
  return `<aside id="dashboard-widget-drawer" class="dashboard-widget-drawer" hidden aria-label="Add widget">
  <div class="dashboard-drawer-head"><h2>+ Add widget</h2>${button({ label: "Close", variant: "ghost", size: "sm", attrs: { type: "button", id: "dashboard-drawer-close" } })}</div>
  <p class="dim">Click Add to place a widget at the end of your layout.</p>
  <div class="dashboard-drawer-list">${items}</div>
</aside>`;
}

export function panelScriptsForLayout(layout: DashboardLayout, showBudget: boolean): string[] {
  const panelIds = new Set<string>();
  for (const w of layout.widgets) {
    const def = widgetById(w.id);
    if (def?.panelId) panelIds.add(def.panelId);
  }
  return panels
    .filter((p) => panelIds.has(p.id))
    .filter((p) => showBudget || p.id !== "budget")
    .map((p) => p.id);
}
