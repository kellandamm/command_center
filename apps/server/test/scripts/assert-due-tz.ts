/**
 * Loaded in a child process with TZ set to exercise due-date math outside UTC.
 */
import assert from "node:assert/strict";
import { addDaysIso, nextDueDate } from "../../src/budget/subscriptions/due";

const tz = process.env.TZ ?? "UTC";

assert.equal(addDaysIso("2026-01-01", 0), "2026-01-01");
assert.equal(nextDueDate("monthly", "2025-01-15", tz, "2025-01-15"), "2025-02-15");
assert.equal(nextDueDate("monthly", "2025-01-01", tz, "2025-01-01"), "2025-02-01");
assert.equal(nextDueDate("yearly", "2025-01-01", tz, "2025-01-01"), "2026-01-01");
assert.equal(nextDueDate("monthly", "2025-01-31", tz, "2025-01-31"), "2025-02-28");
assert.equal(nextDueDate("weekly", "2025-01-06", tz, "2025-01-06"), "2025-01-13");

console.log("OK");
