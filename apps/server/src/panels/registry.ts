import { activityPanel } from "./activity";
import { aiSecurityPanel } from "./ai-security-panel";
import { briefingPanel } from "./briefing";
import { dailyBriefingPanel } from "./daily-briefing-panel";
import { hobiePanel } from "./hobie";
import { taggedNewsPanel } from "./tagged-news";
import { calendarPanel } from "./calendar";
import { feedsPanel } from "./feeds";
import { hostHealthPanel } from "./host-health";
import { notesPanel } from "./notes";
import { recallioPanel } from "./recallio";
import { weatherPanel } from "./weather";
import type { PanelModule } from "./types";

/** Register panels here: one module file + one line in this array. */
export const panels: PanelModule[] = [
  activityPanel,
  hobiePanel,
  taggedNewsPanel,
  dailyBriefingPanel,
  aiSecurityPanel,
  weatherPanel,
  calendarPanel,
  notesPanel,
  feedsPanel,
  briefingPanel,
  hostHealthPanel,
  recallioPanel,
];

export function panelById(id: string): PanelModule | undefined {
  return panels.find((p) => p.id === id);
}
