import {
  baselineForDayIndex,
  baselineForReading,
  buildCycleDayDates,
  burnRateFromHistory,
  cycleEndedAtReading,
  dailyBudgetLeft,
  dayIndexInCycle,
  daysLeftUntilReset,
  paceStatus,
  parseAsOfInstant,
  projectedAtReset,
  readingAgeMs,
  resetCountdownParts,
  runOutBeforeReset,
  runOutEstimate,
  snapshotsInCycle,
} from "./pace";
import { USAGE_READING_STALE_MS } from "./constants";
import type { AgentsUsageStore } from "./store";
import type { UsageCheckin, UsageSnapshot } from "./types";

export interface UsageDashboardPayload {
  latest: UsageSnapshot | null;
  history: UsageSnapshot[];
  computed: {
    weeklyPercentUsed: number | null;
    baseline: number | null;
    dayIndex: number | null;
    daysLeft: number | null;
    cycleEnded: boolean;
    cycleEndedMessage: string | null;
    readingStale: boolean;
    lastReadingAt: string | null;
    lastReadingAgeMs: number | null;
    status: ReturnType<typeof paceStatus>;
    burnRatePerDay: number | null;
    burnLowConfidence: boolean;
    projectedAtReset: number | null;
    runOut: ReturnType<typeof runOutEstimate>;
    runOutBeforeReset: ReturnType<typeof runOutBeforeReset>;
    dailyBudgetLeft: number | null;
    dailyBudgetOverCap: boolean;
    remainingDisplay: number | null;
    remainingOverCap: number | null;
    resetCountdown: ReturnType<typeof resetCountdownParts>;
    resetsAt: string | null;
    metricsUnavailable: boolean;
  };
  byBot: UsageSnapshot["byBot"];
  byRoutine: UsageSnapshot["byRoutine"];
  byDay: UsageSnapshot["byDay"];
  dailyLog: Array<{ asOf: string; weeklyPercentUsed: number | null; resetsAt: string | null }>;
  checkins: UsageCheckin[];
  chart: {
    cumulative: Array<{ asOf: string; value: number | null; baseline: number | null }>;
    dailyIncrements: Array<{ date: string; value: number | null; baseline: number; noData: boolean }>;
  };
}

export function buildUsageDashboard(store: AgentsUsageStore, now = new Date()): UsageDashboardPayload {
  const latest = store.latestSnapshot() ?? null;
  const readingAt = latest ? parseAsOfInstant(latest.asOf) : null;
  const invalidAsOf = Boolean(latest && readingAt === null);

  const cycleEnded = latest && !invalidAsOf && latest.resetsAt ? cycleEndedAtReading(now, latest.resetsAt) : false;
  const hasReset = Boolean(latest?.resetsAt);
  const current = invalidAsOf ? null : latest?.weeklyPercentUsed ?? null;
  const readingAge = readingAt ? readingAgeMs(readingAt, now) : null;
  const readingStale = readingAge !== null && readingAge > USAGE_READING_STALE_MS;

  const metricsUnavailable =
    !latest || invalidAsOf || !hasReset || cycleEnded || latest.weeklyPercentUsed === null;

  const daysLeft = latest && hasReset && !cycleEnded && !invalidAsOf ? daysLeftUntilReset(now, latest.resetsAt) : null;
  const dayIndex = dayIndexInCycle(daysLeft, cycleEnded);
  const baseline = latest && hasReset && !cycleEnded && !invalidAsOf ? baselineForReading(now, latest.resetsAt) : null;

  const history = latest && hasReset && !cycleEnded && !invalidAsOf ? snapshotsInCycle(store.listSnapshots(), latest) : [];

  const burn = metricsUnavailable
    ? { avgPerDay: null, sampleCount: 0, elapsedMs: 0, lowConfidence: false }
    : burnRateFromHistory(history);

  const cumulative = history.map((s) => {
    const pointAt = parseAsOfInstant(s.asOf);
    if (!pointAt) {
      return { asOf: s.asOf, value: s.weeklyPercentUsed, baseline: null };
    }
    const pointEnded = cycleEndedAtReading(pointAt, s.resetsAt);
    const pointDaysLeft = daysLeftUntilReset(pointAt, s.resetsAt);
    const pointDayIndex = dayIndexInCycle(pointDaysLeft, pointEnded);
    const pointBaseline = pointDayIndex !== null ? baselineForDayIndex(pointDayIndex) : null;
    return { asOf: s.asOf, value: s.weeklyPercentUsed, baseline: pointBaseline };
  });

  const byDayMap = new Map((latest?.byDay ?? []).map((row) => [row.date, row.share]));
  const slotDates = (
    latest?.resetsAt
      ? buildCycleDayDates(latest.resetsAt)
      : [...(latest?.byDay ?? []).map((r) => r.date)].sort()
  ).slice(0, 7);
  const dailyIncrements = slotDates.map((date) => {
    if (!byDayMap.has(date)) {
      return { date, value: null, baseline: 100 / 7, noData: true };
    }
    return { date, value: byDayMap.get(date)!, baseline: 100 / 7, noData: false };
  });

  const checkins = [...store.listCheckins()].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.bot.localeCompare(a.bot);
  });

  const budgetRaw = metricsUnavailable ? null : dailyBudgetLeft(current, daysLeft);
  const dailyBudgetOverCap = budgetRaw === 0;
  const remainingRaw = current === null ? null : 100 - current;
  const remainingDisplay = remainingRaw === null ? null : Math.max(0, remainingRaw);
  const remainingOverCap = remainingRaw !== null && remainingRaw < 0 ? -remainingRaw : null;

  const projection = metricsUnavailable ? null : projectedAtReset(current, burn.avgPerDay, daysLeft);
  const runOutEarly =
    metricsUnavailable || projection === null || projection <= 100
      ? null
      : runOutBeforeReset(current, burn.avgPerDay, now, latest!.resetsAt);

  return {
    latest,
    history,
    computed: {
      weeklyPercentUsed: current,
      baseline,
      dayIndex,
      daysLeft,
      cycleEnded,
      cycleEndedMessage: cycleEnded ? "Reset passed, awaiting new reading" : null,
      readingStale,
      lastReadingAt: latest?.asOf ?? null,
      lastReadingAgeMs: readingAge,
      status: paceStatus(current, baseline),
      burnRatePerDay: metricsUnavailable ? null : burn.avgPerDay,
      burnLowConfidence: burn.avgPerDay !== null && burn.lowConfidence,
      projectedAtReset: projection,
      runOut: metricsUnavailable ? { days: null, hours: null } : runOutEstimate(current, burn.avgPerDay),
      runOutBeforeReset: runOutEarly,
      dailyBudgetLeft: budgetRaw,
      dailyBudgetOverCap,
      remainingDisplay,
      remainingOverCap,
      resetCountdown: latest && hasReset && !cycleEnded ? resetCountdownParts(now, latest.resetsAt) : null,
      resetsAt: latest?.resetsAt ?? null,
      metricsUnavailable,
    },
    byBot: latest?.byBot ?? [],
    byRoutine: latest?.byRoutine ?? [],
    byDay: latest?.byDay ?? [],
    dailyLog: store.dailyLog(),
    checkins,
    chart: { cumulative, dailyIncrements },
  };
}
