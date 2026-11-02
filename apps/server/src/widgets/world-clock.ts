import { esc } from "../ui/layout";

const DEFAULT_ZONES = ["America/Chicago", "Europe/London", "Asia/Tokyo"];

function cityLabel(zone: string): string {
  const tail = zone.split("/").pop() ?? zone;
  return tail.replace(/_/g, " ");
}

export function renderWorldClockWidget(config: Record<string, unknown> | undefined, now = new Date()): string {
  const zones = Array.isArray(config?.zones)
    ? config!.zones.filter((z): z is string => typeof z === "string").slice(0, 6)
    : DEFAULT_ZONES;
  const rows = zones
    .map((zone) => {
      let time = "—";
      try {
        time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
      } catch {
        time = "invalid zone";
      }
      return `<div class="world-clock-row"><span>${esc(cityLabel(zone))}</span><b>${esc(time)}</b></div>`;
    })
    .join("");
  return `<div class="widget-world-clock">${rows}</div>`;
}
