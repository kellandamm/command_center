import type { ModelUsage } from "@homepage/agent-core";

/** USD per million tokens. Source: the public pricing page; override with PRICING_JSON if it changes. */
export interface Rate { input: number; output: number; cacheWrite: number; cacheRead: number }
export interface ModelPricing {
  base: Rate;
  /** Applied to a single request whose whole prompt (incl. cache reads/writes) exceeds `threshold`. */
  long?: { threshold: number; rate: Rate };
}

export const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 } },
  "claude-opus-5-5": { base: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    long: { threshold: 100_000, rate: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } },
  },
};

/** Managed Agents session runtime, billed per hour while `running`. We bill wall-clock: an upper bound. */
export const SESSION_USD_PER_HOUR = 0.08;

export function requestCost(model: string, u: ModelUsage, table: Record<string, ModelPricing> = PRICING): number {
  const p = table[model] ?? table["claude-opus-5-5"]!; // unknown model: assume the dearest, never under-count
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const r = p.long && prompt > p.long.threshold ? p.long.rate : p.base;
  return (
    (u.inputTokens * r.input + u.outputTokens * r.output + u.cacheWriteTokens * r.cacheWrite + u.cacheReadTokens * r.cacheRead) /
    1_000_000
  );
}

export const runtimeCost = (ms: number) => (Math.max(0, ms) / 3_600_000) * SESSION_USD_PER_HOUR;

export function loadPricingOverride(json: string | undefined): Record<string, ModelPricing> {
  if (!json) return PRICING;
  const parsed = JSON.parse(json) as Record<string, ModelPricing>;
  return { ...PRICING, ...parsed };
}
