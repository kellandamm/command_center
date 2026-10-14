/** Retention limits for RSS SQLite corpus (see plan). */
export const RETENTION = {
  perFeed: 150,
  global: 40_000,
  unreadMaxAgeDays: 90,
  contentHtmlMaxAgeDays: 14,
} as const;

export const POLL = {
  defaultIntervalMs: 45 * 60_000,
  minIntervalMs: 15 * 60_000,
  maxBackoffMs: 24 * 60 * 60_000,
  maxConcurrent: 5,
  dueBatchSize: 12,
} as const;
