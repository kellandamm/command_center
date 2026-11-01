/**
 * Loaded in a child process with TZ=America/Chicago to ensure due-date math
 * does not depend on the host Date timezone.
 */
import assert from "node:assert/strict";
import { nextDueDate } from "../../src/budget/subscriptions/due.ts";

const tz = "America/Chicago";

assert.equal(nextDueDate("monthly", "2025-01-15", tz, "2025-01-15"), "2025-02-15");
assert.equal(nextDueDate("monthly", "2025-01-01", tz, "2025-01-01"), "2025-02-01");
assert.equal(nextDueDate("yearly", "2025-01-01", tz, "2025-01-01"), "2026-01-01");
assert.equal(nextDueDate("monthly", "2025-01-31", tz, "2025-01-31"), "2025-02-28");

console.log("OK");
