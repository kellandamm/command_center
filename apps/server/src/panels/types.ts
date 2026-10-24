import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import type { NotesStore } from "../notes/store";
import type { BoardStore } from "../board/store";
import type { HobieQueueStore } from "../stores/hobie-queue";
import type { WinsStore } from "../wins/store";
import type { PanelUpdatesStore } from "../stores/panel-updates";
import type { SettingsStore } from "../settings";
import type { CalendarWorkspace } from "../calendar/workspace";
import type { AttentionStore } from "../attention/store";
import type { LaunchpadStore } from "../launchpad/store";
import type { FocusSessionsStore } from "../focus/store";

export interface PanelContext {
  cfg: Config;
  settings: SettingsStore;
  notes: NotesStore;
  panelUpdates: PanelUpdatesStore;
  hobieQueue: HobieQueueStore;
  board: BoardStore;
  wins: WinsStore;
  calendar?: CalendarWorkspace;
  attention: AttentionStore;
  launchpad: LaunchpadStore;
  focusSessions: FocusSessionsStore;
  owner: boolean;
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
