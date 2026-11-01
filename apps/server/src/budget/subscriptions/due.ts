import type { SubscriptionCadence } from "./types";

export function isoParts(iso: string): { y: number; m: number; d: number } {
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

/** Civil calendar day-of-month from stored YYYY-MM-DD (not wall-clock shifted). */
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

/** Days since 1970-01-01 on the civil calendar (UTC serial math, no local TZ). */
function civilEpochDays(iso: string): number {
  const { y, m, d } = isoParts(iso);
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 2483629;
}

function civilEpochToIso(epoch: number): string {
  const z = epoch + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const year = y + (m <= 2 ? 1 : 0);
  return formatIso(year, m <= 2 ? m + 12 : m, d);
}

export function addDaysIso(iso: string, days: number): string {
  return civilEpochToIso(civilEpochDays(iso) + days);
}

export function daysBetweenIso(a: string, b: string): number {
  return civilEpochDays(b) - civilEpochDays(a);
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
