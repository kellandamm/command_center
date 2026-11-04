import { ValidationError } from "../../settings";

const FORBIDDEN_KEY = /^(budget|subscription|vault)$/i;

/** Reject payloads that carry budget, subscription, or vault keys at any depth. */
export function rejectForbiddenPayloadKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectForbiddenPayloadKeys(item);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new ValidationError("forbidden payload key");
    }
    rejectForbiddenPayloadKeys(nested);
  }
}
