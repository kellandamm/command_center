import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

test("subscriptions due: subprocess with TZ=America/Chicago matches civil calendar", async () => {
  const script = join(process.cwd(), "test/scripts/assert-due-chicago.ts");
  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: "America/Chicago" },
  });
  assert.match(stdout, /OK/);
});
