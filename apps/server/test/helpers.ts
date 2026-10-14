import { HobieQueueStore } from "../src/stores/hobie-queue";
import { PanelUpdatesStore } from "../src/stores/panel-updates";

export async function openIntegrationStores(dataDir: string) {
  return {
    panelUpdates: await PanelUpdatesStore.open(dataDir),
    hobieQueue: await HobieQueueStore.open(dataDir),
  };
}
