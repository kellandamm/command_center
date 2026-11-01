import type { SubscriptionCadence } from "./types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isoParts(iso: string): { y: number; m: number; d: number } {
  if (!ISO_DATE_RE.test(iso)) throw new Error("invalid iso date");
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error("invalid iso date");
  return { y, m, d };
}

export function formatIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function compareIso(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Civil calendar day-of-month from stored YYYY-MM-DD. */
export function dayOfMonthInTz(isoDate: string, _tz: string): number {
  return isoParts(isoDate).d;
}

export function anchorDayFromDate(anchorDate: string, tz: string): number {
  return dayOfMonthInTz(anchorDate, tz);
}

function daysInMonth(y: number, month1: number): number {
  return new Date(Date.UTC(y, month1, 0)).getUTCDate();
}

function clampDayToMonth(y: number, month1: number, anchorDay: number): number {
  return Math.min(anchorDay, daysInMonth(y, month1));
}

/** Days since 1970-01-01 UTC on the civil calendar (Date.UTC Y/M/D only). */
export function civilEpochDays(iso: string): number {
  const { y, m, d } = isoParts(iso);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function civilEpochToIso(epoch: number): string {
  const dt = new Date(epoch * 86_400_000);
  return formatIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDaysIso(iso: string, days: number): string {
  return civilEpochToIso(civilEpochDays(iso) + days);
}

export function daysBetweenIso(a: string, b: string): number {
  return civilEpochDays(b) - civilEpochDays(a);
}

/** Returns iso when it is a real calendar date; throws otherwise. */
export function requireValidIsoDate(iso: string): string {
  if (!ISO_DATE_RE.test(iso)) throw new Error("invalid iso date");
  const round = addDaysIso(iso, 0);
  if (round !== iso) throw new Error("invalid iso date");
  return iso;
}

export function safeNextDueDate(
  cadence: SubscriptionCadence,
  anchorDate: string,
  tz: string,
  afterIso: string,
): string | null {
  try {
    requireValidIsoDate(anchorDate);
    requireValidIsoDate(afterIso);
    return nextDueDate(cadence, anchorDate, tz, afterIso);
  } catch {
    return null;
  }
}

/** Circular distance on days 1–31 (month-end wrap). Jan 31 vs Feb 1 → 1. */
export function circularDayDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 31 - diff);
}

/**
 * Next due on or after `afterIso` (ISO), advancing by cadence using anchor day-of-month
 * (month-end clamped when anchor is 29–31). All math on YYYY-MM-DD civil dates.
 */
export function nextDueDate(
  cadence: SubscriptionCadence,
  anchorDate: string,
  tz: string,
  afterIso: string,
): string {
  requireValidIsoDate(anchorDate);
  requireValidIsoDate(afterIso);
  const anchorDay = anchorDayFromDate(anchorDate, tz);

  if (cadence === "weekly") {
    let candidate = anchorDate;
    while (compareIso(candidate, afterIso) <= 0) {
      candidate = addDaysIso(candidate, 7);
    }
    return candidate;
  }

  if (cadence === "yearly") {
    const anchorMonth = isoParts(anchorDate).m;
    let y = isoParts(afterIso).y;
    let d = clampDayToMonth(y, anchorMonth, anchorDay);
    let candidate = formatIso(y, anchorMonth, d);
    if (compareIso(candidate, afterIso) <= 0) {
      y += 1;
      d = clampDayToMonth(y, anchorMonth, anchorDay);
      candidate = formatIso(y, anchorMonth, d);
    }
    return candidate;
  }

  let { y, m } = isoParts(afterIso);
  let d = clampDayToMonth(y, m, anchorDay);
  let candidate = formatIso(y, m, d);
  if (compareIso(candidate, afterIso) <= 0) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    d = clampDayToMonth(y, m, anchorDay);
    candidate = formatIso(y, m, d);
  }
  return candidate;
}

export function annualCostCents(amountCents: number, cadence: SubscriptionCadence): number {
  const abs = Math.abs(amountCents);
  switch (cadence) {
    case "weekly":
      return abs * 52;
    case "monthly":
      return abs * 12;
    case "yearly":
      return abs;
  }
}
