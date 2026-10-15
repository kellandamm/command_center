import { BoardStore } from "../src/board/store";
import { wireHobieBoardSync } from "../src/board/hobie-sync";
import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { panels } from "../src/panels/registry";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { PanelUpdatesStore } from "../src/stores/panel-updates";
import { WinsStore } from "../src/wins/store";
import { WinsRollupService } from "../src/wins/rollup-service";
import type { Config } from "../src/config";

export async function openIntegrationStores(dataDir: string, cfg?: Config) {
  const panelUpdates = await PanelUpdatesStore.open(dataDir);
  const hobieQueue = await HobieQueueStore.open(dataDir);
  const board = BoardStore.open(dataDir);
  const wins = WinsStore.open(dataDir);
  wireHobieBoardSync(hobieQueue, board, wins);
  const winsRollup = cfg ? new WinsRollupService(cfg, wins) : new WinsRollupService(
    { llmBaseUrl: null, llmApiKey: null, llmModel: null } as Config,
    wins,
  );
  return {
    panelUpdates,
    hobieQueue,
    board,
    wins,
    winsRollup,
    dashboardLayout: await DashboardLayoutStore.open(dataDir, panels.map((p) => p.id)),
  };
}
