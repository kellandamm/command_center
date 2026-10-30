import { z } from "zod";
import {
  USAGE_CHECKIN_NOTE_MAX_UTF8_BYTES,
  USAGE_IMPORT_MAX_BOTS,
  USAGE_IMPORT_MAX_BY_DAY,
  USAGE_IMPORT_MAX_CHECKINS,
  USAGE_IMPORT_MAX_ROUTINES,
} from "./constants";
import { truncateUtf8ToBytes } from "../utf8-byte-limit";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const isoDateTime = z.string().min(10).max(64);

const shareRow = z.object({
  name: z.string().trim().min(1).max(120),
  share: z.number().finite().min(0).max(100),
});

const dayRow = z.object({
  date: isoDate,
  share: z.number().finite().min(0).max(100),
});

const onDemandSchema = z
  .object({
    enabled: z.boolean().optional(),
    spent: z.number().finite().nullable().optional(),
    limit: z.number().finite().nullable().optional(),
    currency: z.string().trim().max(8).optional(),
  })
  .strict()
  .partial();

const checkinSchema = z.object({
  bot: z.string().trim().min(1).max(80),
  date: isoDate,
  note: z
    .string()
    .transform((v) => truncateUtf8ToBytes(v, USAGE_CHECKIN_NOTE_MAX_UTF8_BYTES))
    .pipe(z.string().min(1)),
});

export const usageImportBodySchema = z.object({
  asOf: isoDateTime,
  weeklyPercentUsed: z.number().finite().min(0).max(200).nullable(),
  resetsAt: isoDateTime.nullable(),
  onDemand: onDemandSchema.optional(),
  byBot: z.array(shareRow).max(USAGE_IMPORT_MAX_BOTS),
  byRoutine: z.array(shareRow).max(USAGE_IMPORT_MAX_ROUTINES),
  byDay: z.array(dayRow).max(USAGE_IMPORT_MAX_BY_DAY),
  checkins: z.array(checkinSchema).max(USAGE_IMPORT_MAX_CHECKINS).optional(),
});

export type UsageImportBody = z.infer<typeof usageImportBodySchema>;
