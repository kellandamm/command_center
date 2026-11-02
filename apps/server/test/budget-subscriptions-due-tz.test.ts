import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { addDaysIso, civilEpochToIso, civilEpochDays, nextDueDate } from "../src/budget/subscriptions/due";

const execFileAsync = promisify(execFile);

test("subscriptions due: addDaysIso round-trip in UTC host", () => {
  const samples = [
    "2020-01-01",
    "2020-02-29",
    "2024-12-31",
    "2026-01-01",
    "2026-06-15",
    "1999-12-31",
  ];
  for (const iso of samples) {
    assert.equal(addDaysIso(iso, 0), iso, `round-trip ${iso}`);
    assert.equal(addDaysIso(iso, 7), addDaysIso(addDaysIso(iso, 3), 4));
  }
  for (let epoch = civilEpochDays("2023-01-01"); epoch <= civilEpochDays("2027-01-01"); epoch += 17) {
    const iso = civilEpochToIso(epoch);
    assert.equal(addDaysIso(iso, 0), iso, `range round-trip ${iso}`);
  }
});

test("subscriptions due: weekly next due advances seven civil days", () => {
  assert.equal(nextDueDate("weekly", "2025-03-01", "UTC", "2025-03-01"), "2025-03-08");
  assert.equal(nextDueDate("weekly", "2025-03-01", "UTC", "2025-03-08"), "2025-03-15");
});

test("subscriptions due: subprocess with TZ=America/Chicago matches civil calendar", async () => {
  const script = join(process.cwd(), "test/scripts/assert-due-tz.ts");
  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: "America/Chicago" },
  });
  assert.match(stdout, /OK/);
});

test("subscriptions due: subprocess with TZ=Asia/Tokyo matches civil calendar", async () => {
  const script = join(process.cwd(), "test/scripts/assert-due-tz.ts");
  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: "Asia/Tokyo" },
  });
  assert.match(stdout, /OK/);
});
