import type { Config } from "../config";
import { esc } from "../ui/layout";
import type { ServiceCheckResult } from "../service-status/checks";

export function renderServiceStatusWidget(results: ServiceCheckResult[]): string {
  const cells = results
    .map((r) => {
      const dot = r.state === "up" ? "ok" : r.state === "down" ? "bad" : "dim";
      const detail =
        r.state === "not_configured"
          ? "not configured"
          : r.state === "unknown"
            ? "unknown"
            : r.latencyMs != null
              ? `${r.latencyMs} ms`
              : r.downFor ?? "down";
      const border = r.state === "down" ? " service-cell-down" : "";
      return `<div class="service-cell${border}"><span class="dashboard-status-dot dashboard-status-dot--${dot === "ok" ? "green" : dot === "bad" ? "red" : "muted"}"></span><span>${esc(r.label)}</span><span class="dim service-cell-meta">${esc(detail)}</span></div>`;
    })
    .join("");
  return `<div class="widget-service-status service-grid">${cells}</div>`;
}

export async function loadServiceStatusForWidget(cfg: Config): Promise<ServiceCheckResult[]> {
  const { getServiceStatusSnapshot } = await import("../service-status/checks");
  return getServiceStatusSnapshot(cfg);
}
