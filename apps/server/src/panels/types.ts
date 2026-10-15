import type { IncomingMessage, ServerResponse } from "node:http";
import type { BriefingService } from "../briefing/service";
import type { Config } from "../config";
import type { FeedsStore } from "../feeds/store";
import type { NotesStore } from "../notes/store";
import type { BoardStore } from "../board/store";
import type { HobieQueueStore } from "../stores/hobie-queue";
import type { WinsStore } from "../wins/store";
import type { PanelUpdatesStore } from "../stores/panel-updates";
import type { SettingsStore } from "../settings";

export interface PanelContext {
  cfg: Config;
  settings: SettingsStore;
  feeds: FeedsStore;
  briefing: BriefingService;
  notes: NotesStore;
  panelUpdates: PanelUpdatesStore;
  hobieQueue: HobieQueueStore;
  board: BoardStore;
  wins: WinsStore;
}

export type PanelHandler = (ctx: PanelContext, req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>;

export interface PanelModule {
  id: string;
  title: string;
  /** Full-page route for dashboard title link (preview tiles only). */
  pageHref?: string;
  /** HTML fragment for the dashboard (inside a section). */
  dashboardHtml: string;
  /** Return true if the request was handled. */
  handle?: PanelHandler;
}
