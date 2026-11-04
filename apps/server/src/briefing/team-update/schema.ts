import { z } from "zod";
import { normalizedInstantSchema } from "../../agents-usage/datetime";
import {
  TEAM_UPDATE_AGENT_NAME_MAX,
  TEAM_UPDATE_LINE_MAX_UTF8_BYTES,
  TEAM_UPDATE_MAX_AGENTS,
  TEAM_UPDATE_MAX_LINES,
} from "./constants";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const lineSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (utf8ByteLength(value) > TEAM_UPDATE_LINE_MAX_UTF8_BYTES) {
      ctx.addIssue({ code: "custom", message: "line exceeds max bytes" });
    }
  });

const agentSchema = z
  .object({
    name: z.string().trim().min(1).max(TEAM_UPDATE_AGENT_NAME_MAX),
    did: z.array(lineSchema).max(TEAM_UPDATE_MAX_LINES),
    waitingOnKellan: z.array(lineSchema).max(TEAM_UPDATE_MAX_LINES),
    updatedAt: normalizedInstantSchema,
  })
  .strict();

export const teamUpdateImportBodySchema = z
  .object({
    date: isoDate,
    agents: z.array(agentSchema).max(TEAM_UPDATE_MAX_AGENTS),
  })
  .strict();

export type TeamUpdateImportBody = z.infer<typeof teamUpdateImportBodySchema>;
export type TeamUpdateAgentRow = TeamUpdateImportBody["agents"][number];
