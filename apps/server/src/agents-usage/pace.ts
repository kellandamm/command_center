import { PACE_PERCENT_PER_DAY, RESET_AT_JITTER_MS } from "./constants";
import type { UsageSnapshot } from "./types";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const BURN_ELAPSED_FLOOR_MS = MS_PER_HOUR;
export const BURN_LOW_CONFIDENCE_MS = 6 * MS_PER_HOUR;

export function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseAsOfInstant(asOf: string): Date | null {
  return parseInstant(asOf);
}

/** Whole days until reset from `at`, today included (ceil(ms/24h)). Null when no reset time. */
export function daysLeftUntilReset(at: Date, resetsAt: string | null): number | null {
  const reset = parseInstant(resetsAt);
  if (!reset) return null;
  const ms = reset.getTime() - at.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / MS_PER_DAY);
}

/** True when the reading time is at or after the reset instant. */
export function cycleEndedAtReading(readingAt: Date, resetsAt: string | null): boolean {
  const reset = parseInstant(resetsAt);
  if (!reset) return false;
  return readingAt.getTime() >= reset.getTime();
}

/** Day index N for "Day N / 7" when inside an active reset cycle (clamped 1..7). */
export function dayIndexInCycle(daysLeft: number | null, cycleEnded: boolean): number | null {
  if (daysLeft === null || cycleEnded) return null;
  if (daysLeft <= 0) return null;
  const raw = 8 - daysLeft;
  if (raw < 1) return null;
  return Math.min(7, raw);
}

export function baselineForDayIndex(dayIndex: number): number {
  return PACE_PERCENT_PER_DAY * dayIndex;
}

export function baselineForReading(readingAt: Date, resetsAt: string | null): number | null {
  if (cycleEndedAtReading(readingAt, resetsAt)) return null;
  const daysLeft = daysLeftUntilReset(readingAt, resetsAt);
  const dayIndex = dayIndexInCycle(daysLeft, false);
  if (dayIndex === null) return null;
  return baselineForDayIndex(dayIndex);
}

export type PaceStatus = "on_pace" | "ahead" | "behind" | "unknown";

export function paceStatus(current: number | null, baseline: number | null): PaceStatus {
  if (current === null || baseline === null) return "unknown";
  if (current > baseline + 0.05) return "ahead";
  if (current < baseline - 0.05) return "behind";
  return "on_pace";
}

export interface BurnRateResult {
  avgPerDay: number | null;
  sampleCount: number;
  elapsedMs: number;
  lowConfidence: boolean;
}

/**
 * Burn rate from ordered snapshots in the current cycle (null readings excluded).
 * Uses real elapsed time with a 1h floor (not a full-day minimum).
 */
export function burnRateFromHistory(history: UsageSnapshot[]): BurnRateResult {
  const points = history
    .map((s) => ({ t: parseInstant(s.asOf), v: s.weeklyPercentUsed }))
    .filter((p): p is { t: Date; v: number } => p.t !== null && p.v !== null)
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (points.length < 2) {
    return { avgPerDay: null, sampleCount: points.length, elapsedMs: 0, lowConfidence: true };
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = last.v - first.v;
  const elapsedMs = Math.max(0, last.t.getTime() - first.t.getTime());
  const effectiveMs = Math.max(BURN_ELAPSED_FLOOR_MS, elapsedMs);
  return {
    avgPerDay: delta / (effectiveMs / MS_PER_DAY),
    sampleCount: points.length,
    elapsedMs,
    lowConfidence: elapsedMs < BURN_LOW_CONFIDENCE_MS,
  };
}

export function projectedAtReset(
  current: number | null,
  avgPerDay: number | null,
  daysLeft: number | null,
): number | null {
  if (current === null || avgPerDay === null || daysLeft === null) return null;
  return current + avgPerDay * daysLeft;
}

export interface RunOutEstimate {
  days: number | null;
  hours: number | null;
}

function runOutParts(remainingPct: number, avgPerDay: number): RunOutEstimate {
  const days = remainingPct / avgPerDay;
  if (days >= 1) return { days, hours: null };
  const hours = Math.round(days * 24);
  return { days: null, hours: hours < 1 ? 0 : hours };
}

/** When projection exceeds 100%, estimate time until cap at current average rate. */
export function runOutEstimate(current: number | null, avgPerDay: number | null): RunOutEstimate {
  if (current === null || avgPerDay === null || avgPerDay <= 0) return { days: null, hours: null };
  const remaining = 100 - current;
  if (remaining <= 0) return { days: 0, hours: 0 };
  return runOutParts(remaining, avgPerDay);
}

/**
 * Run-out estimate only when the cap is reached before the weekly reset.
 */
export function runOutBeforeReset(
  current: number | null,
  avgPerDay: number | null,
  readingAt: Date,
  resetsAt: string | null,
): RunOutEstimate | null {
  if (current === null || avgPerDay === null || avgPerDay <= 0) return null;
  const remaining = 100 - current;
  if (remaining <= 0) return { days: 0, hours: 0 };
  const reset = parseInstant(resetsAt);
  if (!reset) return null;
  const daysToCap = remaining / avgPerDay;
  const capAtMs = readingAt.getTime() + daysToCap * MS_PER_DAY;
  if (capAtMs >= reset.getTime()) return null;
  return runOutParts(remaining, avgPerDay);
}

export function dailyBudgetLeft(current: number | null, daysLeft: number | null): number | null {
  if (current === null || daysLeft === null || daysLeft <= 0) return null;
  const remaining = 100 - current;
  if (remaining <= 0) return 0;
  return remaining / daysLeft;
}

export function resetCountdownParts(at: Date, resetsAt: string | null): { days: number; hours: number } | null {
  const reset = parseInstant(resetsAt);
  if (!reset) return null;
  const ms = reset.getTime() - at.getTime();
  if (ms <= 0) return { days: 0, hours: 0 };
  const totalHours = Math.floor(ms / MS_PER_HOUR);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}

export function resetAtSameCycle(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const da = parseInstant(a);
  const db = parseInstant(b);
  if (!da || !db) return false;
  return Math.abs(da.getTime() - db.getTime()) <= RESET_AT_JITTER_MS;
}

/** Snapshots in the same reset cycle as `latest` (jitter-tolerant); empty when latest has no resetsAt. */
export function snapshotsInCycle(all: UsageSnapshot[], latest: UsageSnapshot | undefined): UsageSnapshot[] {
  if (!latest?.resetsAt) return latest ? [latest] : [];
  return all
    .filter((s) => s.resetsAt && resetAtSameCycle(s.resetsAt, latest.resetsAt))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
}

export function formatPercent(value: number | null, digits = 1): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = digits === 0 ? Math.round(value) : Math.round(value * 10 ** digits) / 10 ** digits;
  const text = digits === 0 ? String(rounded) : rounded.toFixed(digits).replace(/\.0$/, "");
  return `${text}%`;
}

/** Seven calendar-day slots in the cycle (UTC dates, ending on the reset calendar day). */
export function buildCycleDayDates(resetsAt: string | null): string[] {
  const reset = parseInstant(resetsAt);
  if (!reset) return [];
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth(), reset.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function readingAgeMs(readingAt: Date, now: Date): number {
  return Math.max(0, now.getTime() - readingAt.getTime());
}
