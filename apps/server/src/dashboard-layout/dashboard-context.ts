import { fetchCalendarEvents } from "../calendar/service";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { Config } from "../config";
import { getServiceStatusSnapshot } from "../service-status/checks";
import type { DashboardLayout } from "./types";
import type { DashboardRenderContext } from "./render-page";

export async function buildDashboardRenderContext(
  deps: { cfg: Config; calendar?: CalendarWorkspace },
  layout: DashboardLayout,
  showBudgetPanel: boolean,
): Promise<DashboardRenderContext> {
  let calendarEvents: DashboardRenderContext["calendarEvents"] = [];
  try {
    if (deps.calendar) {
      const snap = await deps.calendar.snapshot({ horizonDays: 2 });
      calendarEvents = snap.events;
    } else {
      const snap = await fetchCalendarEvents(deps.cfg.icsUrls, deps.cfg.tz, {
        horizonDays: 2,
        localFiles: deps.cfg.icsLocalFiles,
      });
      calendarEvents = snap.events;
    }
  } catch {
    calendarEvents = [];
  }
  const serviceStatus = await getServiceStatusSnapshot(deps.cfg);
  return {
    cfg: deps.cfg,
    layout,
    showBudgetPanel,
    calendarEvents,
    serviceStatus,
  };
}
