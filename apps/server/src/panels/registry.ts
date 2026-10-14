import { briefingPanel } from "./briefing";
import { feedsPanel } from "./feeds";
import { todoistPanel } from "./todoist";
import type { PanelModule } from "./types";

/** Register panels here: one module file + one line in this array. */
export const panels: PanelModule[] = [feedsPanel, briefingPanel, todoistPanel];

export function panelById(id: string): PanelModule | undefined {
  return panels.find((p) => p.id === id);
}
