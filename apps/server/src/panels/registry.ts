import { activityPanel } from "./activity";
import { dailyBriefingPanel } from "./daily-briefing-panel";
import { hobiePanel } from "./hobie";
import { calendarPanel } from "./calendar";
import { hostHealthPanel } from "./host-health";
import { notesPanel } from "./notes";
import { recallioPanel } from "./recallio";
import { weatherPanel } from "./weather";
import { tasksPanel } from "./tasks";
import { attentionPanel } from "./attention";
import { heatmapPanel } from "./heatmap";
import { launchpadPanel } from "./launchpad";
import { focusPanel } from "./focus";
import { agentsUsagePanel } from "./agents-usage";
import type { PanelModule } from "./types";

/** Register panels here: one module file + one line in this array. */
export const panels: PanelModule[] = [
  tasksPanel,
  attentionPanel,
  heatmapPanel,
  launchpadPanel,
  focusPanel,
  activityPanel,
  hobiePanel,
  dailyBriefingPanel,
  weatherPanel,
  calendarPanel,
  notesPanel,
  hostHealthPanel,
  recallioPanel,
  agentsUsagePanel,
];

export function panelById(id: string): PanelModule | undefined {
  return panels.find((p) => p.id === id);
}
