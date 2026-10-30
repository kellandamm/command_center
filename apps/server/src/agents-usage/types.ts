export interface UsageOnDemand {
  enabled?: boolean;
  spent?: number | null;
  limit?: number | null;
  currency?: string;
}

export interface UsageShareRow {
  name: string;
  /** Share of weekly usage in percent (0–100), not a 0–1 fraction. */
  share: number;
}

export interface UsageDayRow {
  date: string;
  /** Daily increment in percentage points for that calendar day. */
  share: number;
}

export interface UsageCheckin {
  bot: string;
  date: string;
  note: string;
}

export interface UsageSnapshot {
  asOf: string;
  weeklyPercentUsed: number | null;
  resetsAt: string | null;
  onDemand?: UsageOnDemand;
  byBot: UsageShareRow[];
  byRoutine: UsageShareRow[];
  byDay: UsageDayRow[];
  importedAt: string;
}

export interface AgentsUsageStoreFile {
  snapshots: UsageSnapshot[];
  checkins: UsageCheckin[];
}
