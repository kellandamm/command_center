import { ValidationError } from "../settings";

export const QUICK_ADD_LLM_NOT_CONFIGURED = "LLM is not configured on the server";
export const QUICK_ADD_TODOIST_NOT_CONFIGURED = "Todoist is not configured on the server";
export const QUICK_ADD_LLM_ERROR = "LLM error";
export const QUICK_ADD_TODOIST_ERROR = "Todoist error";
export const QUICK_ADD_CALENDAR_ERROR = "Calendar error";
export const QUICK_ADD_COMMIT_OWNER_REQUIRED =
  "Quick add commit requires a verified owner login through Cloudflare Access. Machine/admin tokens cannot create tasks or events.";

export function commitItemError(err: unknown): string {
  if (err instanceof ValidationError) return err.message;
  if (err instanceof Error) {
    if (/todoist/i.test(err.message)) return QUICK_ADD_TODOIST_ERROR;
    if (/calendar|google/i.test(err.message)) return QUICK_ADD_CALENDAR_ERROR;
  }
  return "Could not save item";
}
