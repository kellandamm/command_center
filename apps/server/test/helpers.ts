import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { panels } from "../src/panels/registry";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { PanelUpdatesStore } from "../src/stores/panel-updates";

export async function openIntegrationStores(dataDir: string) {
  return {
    panelUpdates: await PanelUpdatesStore.open(dataDir),
    hobieQueue: await HobieQueueStore.open(dataDir),
    dashboardLayout: await DashboardLayoutStore.open(dataDir, panels.map((p) => p.id)),
  };
}
