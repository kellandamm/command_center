import { randomUUID } from "node:crypto";
import type { Config } from "../../config";
import { dayKey } from "../../store";
import { normalizePayee } from "../csv";
import { logBudgetError } from "../redact";
import type { BudgetStore } from "../store";
import { circularDayDistance, daysBetweenIso, dayOfMonthInTz } from "./due";
import {
  type DetectionKind,
  type OutflowCharge,
  type SubscriptionCadence,
  POSSIBLE_YEARLY_CONFIDENCE_THRESHOLD,
  STANDARD_CONFIDENCE_THRESHOLD,
} from "./types";

export { circularDayDistance, daysBetweenIso, dayOfMonthInTz };

export function amountTolerance(medianAbsCents: number): number {
  return Math.max(50, Math.round(Math.abs(medianAbsCents) * 0.02));
}

export function amountInCluster(medianAbsCents: number, amountCents: number): boolean {
  const tol = amountTolerance(medianAbsCents);
  return Math.abs(Math.abs(amountCents) - Math.abs(medianAbsCents)) <= tol;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stdev(nums: number[]): number {
  if (nums.length <= 1) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

export function gapToCadence(gapDays: number): SubscriptionCadence | null {
  if (gapDays >= 6 && gapDays <= 8) return "weekly";
  if (gapDays >= 27 && gapDays <= 33) return "monthly";
  if (gapDays >= 345 && gapDays <= 385) return "yearly";
  return null;
}

function gapScore(gaps: number[]): number {
  if (!gaps.length) return 0;
  const med = median(gaps);
  if (med === 0) return 0;
  const sd = stdev(gaps);
  return Math.max(0, 1 - sd / med);
}

function amountScore(charges: OutflowCharge[], medianAbs: number): number {
  if (!charges.length) return 0;
  const ok = charges.filter((c) => amountInCluster(medianAbs, c.amountCents)).length;
  return ok / charges.length;
}

function sampleScore(cadence: SubscriptionCadence, n: number, kind: DetectionKind): number {
  if (cadence === "yearly" && kind === "possible_yearly") return 0.9;
  if (cadence === "yearly" && n >= 3) return 1;
  return Math.min(1, (n - 1) / 2);
}

export function computeConfidence(
  cadence: SubscriptionCadence,
  gaps: number[],
  charges: OutflowCharge[],
  medianAbs: number,
  kind: DetectionKind,
): number {
  const gs = gapScore(gaps);
  const as = amountScore(charges, medianAbs);
  const ss = sampleScore(cadence, charges.length, kind);
  return Math.min(1, Math.max(0, gs * as * ss));
}

/** Stable detection identity: payee + cadence + band anchor (min abs cents in cluster). */
export function stableLaneKey(
  payeeNormalized: string,
  cadence: SubscriptionCadence,
  bandAnchorAbsCents: number,
): string {
  return `${payeeNormalized}|${cadence}|${Math.abs(bandAnchorAbsCents)}`;
}

/** Split monthly/yearly lanes when billing day jumps by >3 (circular). Weekly: one sublane. */
export function splitBillingDaySublanes(
  charges: OutflowCharge[],
  cadence: SubscriptionCadence,
  tz: string,
): OutflowCharge[][] {
  if (cadence === "weekly" || charges.length === 0) return [charges];
  const sublanes: OutflowCharge[][] = [];
  let current: OutflowCharge[] = [charges[0]!];
  for (let i = 1; i < charges.length; i++) {
    const prevDay = dayOfMonthInTz(charges[i - 1]!.date, tz);
    const day = dayOfMonthInTz(charges[i]!.date, tz);
    if (circularDayDistance(prevDay, day) > 3) {
      sublanes.push(current);
      current = [charges[i]!];
    } else {
      current.push(charges[i]!);
    }
  }
  sublanes.push(current);
  return sublanes;
}

function splitCadenceRuns(charges: OutflowCharge[]): Array<{ cadence: SubscriptionCadence; charges: OutflowCharge[] }> {
  if (charges.length === 0) return [];
  const runs: Array<{ cadence: SubscriptionCadence; charges: OutflowCharge[] }> = [];
  let current: OutflowCharge[] = [charges[0]!];
  let currentCadence: SubscriptionCadence | null = null;

  for (let i = 1; i < charges.length; i++) {
    const gap = daysBetweenIso(charges[i - 1]!.date, charges[i]!.date);
    const gapCad = gapToCadence(gap);
    if (currentCadence == null) {
      if (gapCad) {
        currentCadence = gapCad;
        current.push(charges[i]!);
      } else {
        if (current.length >= 2 && currentCadence) {
          runs.push({ cadence: currentCadence, charges: [...current] });
        }
        current = [charges[i]!];
        currentCadence = null;
      }
    } else if (gapCad === currentCadence) {
      current.push(charges[i]!);
    } else {
      runs.push({ cadence: currentCadence, charges: [...current] });
      current = [charges[i]!];
      currentCadence = gapCad;
    }
  }
  if (current.length >= 2 && currentCadence) {
    runs.push({ cadence: currentCadence, charges: current });
  }
  return runs;
}

function passesCadenceRules(cadence: SubscriptionCadence, gaps: number[], n: number): boolean {
  if (cadence === "weekly") {
    if (n < 3) return false;
    const med = median(gaps);
    if (med < 6 || med > 8) return false;
    return stdev(gaps) <= 1.5;
  }
  if (cadence === "monthly") {
    if (n < 3) return false;
    const med = median(gaps);
    if (med < 27 || med > 33) return false;
    return stdev(gaps) <= 4;
  }
  if (n === 2) {
    const g = gaps[0]!;
    return g >= 345 && g <= 385;
  }
  if (n < 3) return false;
  const med = median(gaps);
  return med >= 345 && med <= 385 && stdev(gaps) <= 15;
}

export interface DetectionCandidate {
  payeeNormalized: string;
  displayName: string;
  amountCents: number;
  cadence: SubscriptionCadence;
  detectionKind: DetectionKind;
  confidence: number;
  sampleDates: string[];
  laneKey: string;
}

export function detectCandidatesFromCharges(charges: OutflowCharge[], tz: string): DetectionCandidate[] {
  const byPayee = new Map<string, OutflowCharge[]>();
  for (const c of charges) {
    const list = byPayee.get(c.payeeNormalized) ?? [];
    list.push(c);
    byPayee.set(c.payeeNormalized, list);
  }

  const out: DetectionCandidate[] = [];
  for (const [, payeeCharges] of byPayee) {
    payeeCharges.sort((a, b) => a.date.localeCompare(b.date));
    const amountClusters = clusterByAmount(payeeCharges);
    for (const clustered of amountClusters) {
      if (clustered.length < 2) continue;
      clustered.sort((a, b) => a.date.localeCompare(b.date));
      const medAbs = median(clustered.map((c) => Math.abs(c.amountCents)));
      const runs = splitCadenceRuns(clustered);
      for (const run of runs) {
        const laneCharges = run.charges.filter((c) => amountInCluster(medAbs, c.amountCents));
        if (laneCharges.length < 2) continue;

        const sublanes = splitBillingDaySublanes(laneCharges, run.cadence, tz);
      for (const sub of sublanes) {
        const dates = sub.map((c) => c.date);
        const gaps: number[] = [];
        for (let i = 1; i < dates.length; i++) gaps.push(daysBetweenIso(dates[i - 1]!, dates[i]!));
        if (!passesCadenceRules(run.cadence, gaps, sub.length)) continue;

        const kind: DetectionKind =
          run.cadence === "yearly" && sub.length === 2 ? "possible_yearly" : "standard";
        const conf = computeConfidence(run.cadence, gaps, sub, medAbs, kind);
        const threshold =
          kind === "possible_yearly" ? POSSIBLE_YEARLY_CONFIDENCE_THRESHOLD : STANDARD_CONFIDENCE_THRESHOLD;
        if (conf < threshold) continue;

        const bandAnchorAbs = Math.min(...sub.map((c) => Math.abs(c.amountCents)));
        const repAmount = -Math.round(medAbs);
        const displayName = sub[sub.length - 1]!.payee.trim() || sub[0]!.payeeNormalized;
        out.push({
          payeeNormalized: sub[0]!.payeeNormalized,
          displayName,
          amountCents: repAmount,
          cadence: run.cadence,
          detectionKind: kind,
          confidence: conf,
          sampleDates: dates,
          laneKey: stableLaneKey(sub[0]!.payeeNormalized, run.cadence, bandAnchorAbs),
        });
      }
      }
    }
  }
  return out;
}

/** Partition charges into amount clusters (median tolerance) within one cadence lane. */
export function clusterByAmount(charges: OutflowCharge[]): OutflowCharge[][] {
  const remaining = [...charges].sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents));
  const clusters: OutflowCharge[][] = [];
  while (remaining.length) {
    const seed = remaining.shift()!;
    const medAbs = Math.abs(seed.amountCents);
    const group = [seed];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (amountInCluster(medAbs, remaining[i]!.amountCents)) {
        group.push(remaining[i]!);
        remaining.splice(i, 1);
      }
    }
    clusters.push(group);
  }
  return clusters;
}

function lookbackStartIso(cfg: Config, now = new Date()): string {
  const end = dayKey(now, cfg.tz);
  const [y, m, d] = end.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 19, d!));
  return dayKey(start, cfg.tz);
}

export function runSubscriptionDetection(store: BudgetStore, cfg: Config): { inserted: number; scanned: number } {
  try {
    const since = lookbackStartIso(cfg);
    const rows = store.listOutflowChargesSince(since);
    const charges: OutflowCharge[] = rows.map((r) => ({
      date: r.date,
      amountCents: r.amountCents,
      payee: r.payee,
      payeeNormalized: normalizePayee(r.payee),
    }));
    const candidates = detectCandidatesFromCharges(charges, cfg.tz);
    store.syncActiveSubscriptionAmountsFromCharges(charges);
    let inserted = 0;
    for (const c of candidates) {
      if (store.hasSubscriptionSuppressingDetection(c.payeeNormalized, c.cadence, c.amountCents)) continue;
      if (store.isDetectionPermanentlyDismissed(c.payeeNormalized, c.cadence, c.amountCents)) continue;
      if (store.hasPendingDetectionMatch(c.payeeNormalized, c.cadence, c.amountCents)) continue;
      store.insertDetection({
        id: randomUUID(),
        payeeNormalized: c.payeeNormalized,
        displayName: c.displayName,
        amountCents: c.amountCents,
        cadence: c.cadence,
        detectionKind: c.detectionKind,
        confidence: c.confidence,
        sampleDates: c.sampleDates,
        laneKey: c.laneKey,
      });
      inserted++;
    }
    return { inserted, scanned: charges.length };
  } catch {
    logBudgetError("subscription_scan_failed");
    return { inserted: 0, scanned: 0 };
  }
}
