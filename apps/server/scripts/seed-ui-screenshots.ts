/**
 * Seed local data for UI screenshot capture (dashboard panels, Hobie, activity).
 * Usage: DATA_DIR=/tmp/cc-ui-shot tsx scripts/seed-ui-screenshots.ts
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = process.env.DATA_DIR;
if (!dir) {
  console.error("DATA_DIR is required");
  process.exit(1);
}

const serverDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function run(script: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", script], {
      cwd: serverDir,
      env: { ...process.env, DATA_DIR: dir },
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

async function main() {
  await run("scripts/seed-dashboard-screenshot.ts");
  console.log("seed-ui-screenshots complete at", dir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
