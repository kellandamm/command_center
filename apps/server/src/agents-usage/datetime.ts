import { z } from "zod";

const HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

/** ISO datetime with explicit Z or numeric offset; stored as canonical UTC (toISOString). */
export function parseNormalizeInstant(raw: string, field: string): string {
  const trimmed = raw.trim();
  if (!HAS_OFFSET.test(trimmed)) {
    throw new Error(`${field} must include a timezone offset or Z`);
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} is not a valid datetime`);
  }
  return d.toISOString();
}

export const normalizedInstantSchema = z.string().max(64).transform((value, ctx) => {
  try {
    return parseNormalizeInstant(value, "instant");
  } catch (err) {
    ctx.addIssue({ code: "custom", message: err instanceof Error ? err.message : "invalid datetime" });
    return z.NEVER;
  }
});

export const normalizedInstantNullableSchema = z
  .string()
  .max(64)
  .nullable()
  .transform((value, ctx) => {
    if (value === null) return null;
    try {
      return parseNormalizeInstant(value, "resetsAt");
    } catch (err) {
      ctx.addIssue({ code: "custom", message: err instanceof Error ? err.message : "invalid datetime" });
      return z.NEVER;
    }
  });
