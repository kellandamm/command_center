import { esc } from "../ui/layout";

export function renderCountdownWidget(config: Record<string, unknown> | undefined, now = new Date()): string {
  const label = typeof config?.label === "string" ? config.label : "Target date";
  const targetRaw = typeof config?.target === "string" ? config.target : "2026-12-31";
  const target = Date.parse(`${targetRaw}T23:59:59Z`);
  const ms = Number.isFinite(target) ? target - now.getTime() : 0;
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  const hours = Math.max(0, Math.floor((ms % 86_400_000) / 3_600_000));
  return `<div class="widget-countdown"><div class="countdown-big">${days}d ${String(hours).padStart(2, "0")}h</div><p class="dim">until ${esc(label)}</p></div>`;
}
