import { PACE_PERCENT_PER_DAY } from "./constants";
import type { UsageSnapshot } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days until reset, today included (ceil(ms/24h)). */
export function daysLeftUntilReset(now: Date, resetsAt: string | null): number | null {
  const reset = parseInstant(resetsAt);
  if (!reset) return null;
  const ms = reset.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / MS_PER_DAY);
}

/** Day index N for "Day N / 7" when inside an active reset cycle. */
export function dayIndexInCycle(daysLeft: number | null): number | null {
  if (daysLeft === null) return null;
  return 8 - daysLeft;
}

export function baselineForDayIndex(dayIndex: number): number {
  return PACE_PERCENT_PER_DAY * dayIndex;
}

export function baselineForNow(now: Date, resetsAt: string | null): number | null {
  const daysLeft = daysLeftUntilReset(now, resetsAt);
  const dayIndex = dayIndexInCycle(daysLeft);
  if (dayIndex === null || dayIndex < 1) return null;
  return baselineForDayIndex(dayIndex);
}

export type PaceStatus = "on_pace" | "ahead" | "unknown";

export function paceStatus(current: number | null, baseline: number | null): PaceStatus {
  if (current === null || baseline === null) return "unknown";
  if (current > baseline + 0.05) return "ahead";
  return "on_pace";
}

export interface BurnRateResult {
  /** Average percentage points per day from snapshot history in the cycle. */
  avgPerDay: number | null;
  sampleCount: number;
}

/**
 * Burn rate from ordered snapshots in the current cycle (null readings excluded).
 * Uses first→last cumulative delta divided by elapsed whole days (minimum 1).
 */
export function burnRateFromHistory(now: Date, history: UsageSnapshot[]): BurnRateResult {
  const points = history
    .map((s) => ({ t: parseInstant(s.asOf), v: s.weeklyPercentUsed }))
    .filter((p): p is { t: Date; v: number } => p.t !== null && p.v !== null)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (points.length < 2) return { avgPerDay: null, sampleCount: points.length };
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = last.v - first.v;
  const elapsedDays = Math.max(1, (last.t.getTime() - first.t.getTime()) / MS_PER_DAY);
  return { avgPerDay: delta / elapsedDays, sampleCount: points.length };
}

export function projectedAtReset(current: number | null, avgPerDay: number | null, daysLeft: number | null): number | null {
  if (current === null || avgPerDay === null || daysLeft === null) return null;
  return current + avgPerDay * daysLeft;
}

export interface RunOutEstimate {
  days: number | null;
  hours: number | null;
}

/** When projection exceeds 100%, estimate time until cap at current average rate. */
export function runOutEstimate(
  current: number | null,
  avgPerDay: number | null,
): RunOutEstimate {
  if (current === null || avgPerDay === null || avgPerDay <= 0) return { days: null, hours: null };
  const remaining = 100 - current;
  if (remaining <= 0) return { days: 0, hours: 0 };
  const days = remaining / avgPerDay;
  if (days >= 1) return { days, hours: null };
  return { days: null, hours: Math.round(days * 24) };
}

export function dailyBudgetLeft(current: number | null, daysLeft: number | null): number | null {
  if (current === null || daysLeft === null || daysLeft <= 0) return null;
  const remaining = 100 - current;
  return remaining / daysLeft;
}

export function resetCountdownParts(now: Date, resetsAt: string | null): { days: number; hours: number } | null {
  const reset = parseInstant(resetsAt);
  if (!reset) return null;
  const ms = reset.getTime() - now.getTime();
  if (ms <= 0) return { days: 0, hours: 0 };
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}

/** Snapshots belonging to the same reset window as `latest`. */
export function snapshotsInCycle(all: UsageSnapshot[], latest: UsageSnapshot | undefined): UsageSnapshot[] {
  if (!latest) return [];
  const key = latest.resetsAt ?? "__unknown__";
  return all
    .filter((s) => (s.resetsAt ?? "__unknown__") === key)
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
}

export function formatPercent(value: number | null, digits = 1): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = digits === 0 ? Math.round(value) : Math.round(value * 10 ** digits) / 10 ** digits;
  const text = digits === 0 ? String(rounded) : rounded.toFixed(digits).replace(/\.0$/, "");
  return `${text}%`;
}
