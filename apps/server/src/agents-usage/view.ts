import {
  baselineForDayIndex,
  baselineForNow,
  burnRateFromHistory,
  dailyBudgetLeft,
  dayIndexInCycle,
  daysLeftUntilReset,
  paceStatus,
  projectedAtReset,
  resetCountdownParts,
  runOutEstimate,
  snapshotsInCycle,
} from "./pace";
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
    status: ReturnType<typeof paceStatus>;
    burnRatePerDay: number | null;
    projectedAtReset: number | null;
    runOut: ReturnType<typeof runOutEstimate>;
    dailyBudgetLeft: number | null;
    resetCountdown: ReturnType<typeof resetCountdownParts>;
    resetsAt: string | null;
  };
  byBot: UsageSnapshot["byBot"];
  byRoutine: UsageSnapshot["byRoutine"];
  byDay: UsageSnapshot["byDay"];
  dailyLog: Array<{ asOf: string; weeklyPercentUsed: number | null; resetsAt: string | null }>;
  checkins: UsageCheckin[];
  chart: {
    cumulative: Array<{ asOf: string; value: number | null; baseline: number | null }>;
    dailyIncrements: Array<{ date: string; value: number; baseline: number }>;
  };
}

export function buildUsageDashboard(store: AgentsUsageStore, now = new Date()): UsageDashboardPayload {
  const latest = store.latestSnapshot() ?? null;
  const history = latest ? snapshotsInCycle(store.listSnapshots(), latest) : [];
  const daysLeft = latest ? daysLeftUntilReset(now, latest.resetsAt) : null;
  const dayIndex = dayIndexInCycle(daysLeft);
  const baseline = latest ? baselineForNow(now, latest.resetsAt) : null;
  const current = latest?.weeklyPercentUsed ?? null;
  const burn = burnRateFromHistory(now, history);

  const cumulative = history.map((s, index) => {
    const pointDaysLeft = daysLeftUntilReset(parseAsOf(s.asOf), s.resetsAt);
    const pointDayIndex = dayIndexInCycle(pointDaysLeft);
    const pointBaseline = pointDayIndex !== null ? baselineForDayIndex(pointDayIndex) : null;
    return { asOf: s.asOf, value: s.weeklyPercentUsed, baseline: pointBaseline };
  });

  const dailyIncrements = (latest?.byDay ?? []).map((row) => ({
    date: row.date,
    value: row.share,
    baseline: 100 / 7,
  }));

  const checkins = [...store.listCheckins()].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.bot.localeCompare(a.bot);
  });

  return {
    latest,
    history,
    computed: {
      weeklyPercentUsed: current,
      baseline,
      dayIndex,
      daysLeft,
      status: paceStatus(current, baseline),
      burnRatePerDay: burn.avgPerDay,
      projectedAtReset: projectedAtReset(current, burn.avgPerDay, daysLeft),
      runOut: runOutEstimate(current, burn.avgPerDay),
      dailyBudgetLeft: dailyBudgetLeft(current, daysLeft),
      resetCountdown: latest ? resetCountdownParts(now, latest.resetsAt) : null,
      resetsAt: latest?.resetsAt ?? null,
    },
    byBot: latest?.byBot ?? [],
    byRoutine: latest?.byRoutine ?? [],
    byDay: latest?.byDay ?? [],
    dailyLog: store.dailyLog(),
    checkins,
    chart: { cumulative, dailyIncrements },
  };
}

function parseAsOf(asOf: string): Date {
  const d = new Date(asOf);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
