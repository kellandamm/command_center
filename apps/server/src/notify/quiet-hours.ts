/** Quiet hours for phone notifications always use Chicago local time. */
export const NTFY_QUIET_TZ = "America/Chicago";

/** Parse `22-7` style quiet window (local hours in Chicago, end exclusive). */
export function parseQuietHours(raw: string | null): { startHour: number; endHour: number } | null {
  if (!raw?.trim()) return null;
  const m = raw.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return null;
  const startHour = Number(m[1]);
  const endHour = Number(m[2]);
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
    return null;
  }
  if (startHour === endHour) return null;
  return { startHour, endHour };
}

export function localHour(now: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return Number(parts.hour);
}

export function inQuietHours(now: Date, window: { startHour: number; endHour: number }): boolean {
  const hour = localHour(now, NTFY_QUIET_TZ);
  const { startHour, endHour } = window;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}
