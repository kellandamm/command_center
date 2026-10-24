import { BoardStore } from "../src/board/store";
import { BookmarksStore } from "../src/bookmarks/store";
import { wireHobieBoardSync } from "../src/board/hobie-sync";
import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { panels } from "../src/panels/registry";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { PanelUpdatesStore } from "../src/stores/panel-updates";
import { WinsStore } from "../src/wins/store";
import { WinsRollupService } from "../src/wins/rollup-service";
import { AttentionStore } from "../src/attention/store";
import { LaunchpadStore } from "../src/launchpad/store";
import type { Config } from "../src/config";
import type { Server } from "node:http";

export async function closeIntegrationServer(
  server: Server,
  integration: { board: BoardStore; wins: WinsStore },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
  integration.board.close();
  integration.wins.close();
}

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
    bookmarks: await BookmarksStore.open(dataDir),
    panelUpdates,
    hobieQueue,
    board,
    wins,
    winsRollup,
    dashboardLayout: await DashboardLayoutStore.open(dataDir, panels.map((p) => p.id)),
    attention: await AttentionStore.open(dataDir),
    launchpad: await LaunchpadStore.open(dataDir),
  };
}
