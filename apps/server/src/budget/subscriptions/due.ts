import type { SubscriptionCadence } from "./types";

/** Calendar day of month (1–31) for an ISO date string in the given timezone. */
export function dayOfMonthInTz(isoDate: string, tz: string): number {
  const d = parseIsoDate(isoDate);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).formatToParts(d);
  return Number(parts.find((p) => p.type === "day")!.value);
}

export function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** Circular distance on days 1–31 (month-end wrap). Jan 31 vs Feb 1 → 1. */
export function circularDayDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 31 - diff);
}

export function daysBetweenIso(a: string, b: string): number {
  const ms = parseIsoDate(b).getTime() - parseIsoDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function clampDayToMonth(year: number, month1: number, anchorDay: number): number {
  return Math.min(anchorDay, lastDayOfMonth(year, month1));
}

function formatIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Anchor day derived from anchor_date (ISO) in workspace tz. */
export function anchorDayFromDate(anchorDate: string, tz: string): number {
  return dayOfMonthInTz(anchorDate, tz);
}

/**
 * Next due on or after `after` (ISO), advancing by cadence using anchor day-of-month
 * (month-end clamped when anchor is 29–31).
 */
export function nextDueDate(
  cadence: SubscriptionCadence,
  anchorDate: string,
  tz: string,
  afterIso: string,
): string {
  const anchorDay = anchorDayFromDate(anchorDate, tz);
  const after = parseIsoDate(afterIso);

  if (cadence === "weekly") {
    let candidate = parseIsoDate(anchorDate);
    while (candidate <= after) {
      candidate = new Date(candidate.getTime() + 7 * 86_400_000);
    }
    return formatIso(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, candidate.getUTCDate());
  }

  if (cadence === "yearly") {
    const anchor = parseIsoDate(anchorDate);
    let y = after.getUTCFullYear();
    let m = anchor.getUTCMonth() + 1;
    let d = clampDayToMonth(y, m, anchorDay);
    let candidate = parseIsoDate(formatIso(y, m, d));
    if (candidate <= after) {
      y += 1;
      d = clampDayToMonth(y, m, anchorDay);
      candidate = parseIsoDate(formatIso(y, m, d));
    }
    return formatIso(y, m, d);
  }

  // monthly
  let y = after.getUTCFullYear();
  let m = after.getUTCMonth() + 1;
  let d = clampDayToMonth(y, m, anchorDay);
  let candidate = parseIsoDate(formatIso(y, m, d));
  if (candidate <= after) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    d = clampDayToMonth(y, m, anchorDay);
    candidate = parseIsoDate(formatIso(y, m, d));
  }
  return formatIso(y, m, d);
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
