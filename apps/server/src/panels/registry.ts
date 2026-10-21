import { activityPanel } from "./activity";
import { dailyBriefingPanel } from "./daily-briefing-panel";
import { hobiePanel } from "./hobie";
import { calendarPanel } from "./calendar";
import { hostHealthPanel } from "./host-health";
import { notesPanel } from "./notes";
import { recallioPanel } from "./recallio";
import { weatherPanel } from "./weather";
import type { PanelModule } from "./types";

/** Register panels here: one module file + one line in this array. */
export const panels: PanelModule[] = [
  activityPanel,
  hobiePanel,
  dailyBriefingPanel,
  weatherPanel,
  calendarPanel,
  notesPanel,
  hostHealthPanel,
  recallioPanel,
];

export function panelById(id: string): PanelModule | undefined {
  return panels.find((p) => p.id === id);
}
