import { activityPanel } from "./activity";
import { briefingPanel } from "./briefing";
import { hobiePanel } from "./hobie";
import { calendarPanel } from "./calendar";
import { feedsPanel } from "./feeds";
import { githubPanel } from "./github";
import { hostHealthPanel } from "./host-health";
import { notesPanel } from "./notes";
import { recallioPanel } from "./recallio";
import { todoistPanel } from "./todoist";
import { weatherPanel } from "./weather";
import type { PanelModule } from "./types";

/** Register panels here: one module file + one line in this array. */
export const panels: PanelModule[] = [
  activityPanel,
  hobiePanel,
  weatherPanel,
  calendarPanel,
  notesPanel,
  feedsPanel,
  briefingPanel,
  todoistPanel,
  hostHealthPanel,
  githubPanel,
  recallioPanel,
];

export function panelById(id: string): PanelModule | undefined {
  return panels.find((p) => p.id === id);
}
