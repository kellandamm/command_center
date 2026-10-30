import { BoardStore } from "../src/board/store";
import { BookmarksStore } from "../src/bookmarks/store";
import { wireHobieBoardSync } from "../src/board/hobie-sync";
import { DashboardLayoutStore } from "../src/dashboard-layout/storage";
import { panels } from "../src/panels/registry";
import { HobieQueueStore } from "../src/stores/hobie-queue";
import { AgentTaskQueueStore } from "../src/stores/agent-task-queue";
import { AgentApprovalsStore } from "../src/stores/agent-approvals";
import { PanelUpdatesStore } from "../src/stores/panel-updates";
import { WinsStore } from "../src/wins/store";
import { WinsRollupService } from "../src/wins/rollup-service";
import { AttentionStore } from "../src/attention/store";
import { LaunchpadStore } from "../src/launchpad/store";
import { FocusSessionsStore } from "../src/focus/store";
import { WhiteboardStore } from "../src/whiteboard/store";
import type { Config } from "../src/config";
import type { Server } from "node:http";
import { XBookmarksStore } from "../src/read-later/x-bookmarks-store";
import { XBookmarksService } from "../src/read-later/x-bookmarks-service";
import { ShareLinksStore } from "../src/share-links/store";
import { VoiceCaptureStore } from "../src/voice-capture/store";
import { AgentsUsageStore } from "../src/agents-usage/store";

export async function closeIntegrationServer(
  server: Server,
  integration: { board: BoardStore; wins: WinsStore; xBookmarksService: XBookmarksService },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
  await integration.xBookmarksService.drain();
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
  const xBookmarks = await XBookmarksStore.open(dataDir);
  const xBookmarksService = cfg
    ? new XBookmarksService(cfg, xBookmarks)
    : new XBookmarksService({ llmBaseUrl: null, llmApiKey: null, llmModel: null } as Config, xBookmarks);
  return {
    bookmarks: await BookmarksStore.open(dataDir),
    xBookmarks,
    xBookmarksService,
    panelUpdates,
    hobieQueue,
    agentTaskQueue: await AgentTaskQueueStore.open(dataDir),
    agentApprovals: await AgentApprovalsStore.open(dataDir),
    board,
    wins,
    winsRollup,
    dashboardLayout: await DashboardLayoutStore.open(dataDir, panels.map((p) => p.id)),
    attention: await AttentionStore.open(dataDir),
    launchpad: await LaunchpadStore.open(dataDir),
    focusSessions: await FocusSessionsStore.open(dataDir),
    shareLinks: await ShareLinksStore.open(dataDir),
    whiteboard: await WhiteboardStore.open(dataDir),
    voiceCaptures: await VoiceCaptureStore.open(dataDir),
    agentsUsage: await AgentsUsageStore.open(dataDir),
  };
}
