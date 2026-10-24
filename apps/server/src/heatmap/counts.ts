export const HEATMAP_WEEKS = 26;

export interface HeatmapDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function heatmapDateRange(today = new Date()): { start: string; end: string; days: string[] } {
  const end = ymdUtc(today);
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - HEATMAP_WEEKS * 7 + 1);
  const start = ymdUtc(startDate);
  const days: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    days.push(ymdUtc(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { start, end, days };
}

export function dayKeyFromIso(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function aggregateDailyCounts(
  timestamps: string[],
  tz: string,
  rangeDays: string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of rangeDays) counts.set(day, 0);
  const set = new Set(rangeDays);
  for (const iso of timestamps) {
    const key = dayKeyFromIso(iso, tz);
    if (!set.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function intensityLevel(count: number, max: number): HeatmapDay["level"] {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function buildHeatmapDays(counts: Map<string, number>, orderedDays: string[]): HeatmapDay[] {
  const max = orderedDays.reduce((m, d) => Math.max(m, counts.get(d) ?? 0), 0);
  return orderedDays.map((date) => {
    const count = counts.get(date) ?? 0;
    return { date, count, level: intensityLevel(count, max) };
  });
}
