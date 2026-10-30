/** Max JSON body size for POST /api/agents/usage/import. */
export const USAGE_IMPORT_MAX_BYTES = 256_000;

export const USAGE_IMPORT_MAX_BOTS = 64;
export const USAGE_IMPORT_MAX_ROUTINES = 128;
export const USAGE_IMPORT_MAX_BY_DAY = 14;
export const USAGE_IMPORT_MAX_CHECKINS = 200;
export const USAGE_CHECKIN_NOTE_MAX_UTF8_BYTES = 4_000;

/** Retained snapshot rows (newest kept). */
export const USAGE_SNAPSHOT_HISTORY_MAX = 400;

/** Drop check-ins older than this many calendar days (by `date`). */
export const USAGE_CHECKIN_RETAIN_DAYS = 60;

/** Max check-in rows kept per bot after import. */
export const USAGE_CHECKIN_MAX_PER_BOT = 120;

/** resetsAt values within this window are treated as the same cycle. */
export const RESET_AT_JITTER_MS = 5 * 60 * 1000;

/** Daily target baseline: even split of 100% across 7 days. */
export const PACE_PERCENT_PER_DAY = 100 / 7;
