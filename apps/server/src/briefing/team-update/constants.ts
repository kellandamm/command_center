/** Max JSON body size for POST /api/team-update/import. */
export const TEAM_UPDATE_IMPORT_MAX_BYTES = 64 * 1024;

export const TEAM_UPDATE_MAX_AGENTS = 32;
export const TEAM_UPDATE_MAX_LINES = 20;
export const TEAM_UPDATE_LINE_MAX_UTF8_BYTES = 500;
export const TEAM_UPDATE_AGENT_NAME_MAX = 80;

/** Drop stored days older than this many calendar days (by `date`). */
export const TEAM_UPDATE_RETAIN_DAYS = 30;
