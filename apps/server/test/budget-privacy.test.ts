import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import { SERVICE_WORKER } from "../src/pwa";
import { notesForLlmContext } from "../src/notes/sensitive";
import { logBudgetError } from "../src/budget/redact";
import { transactionFingerprint } from "../src/budget/csv";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";
const PLANT = "PLANT_SECRET_PAYEE";

async function openBudgetHttp() {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-privacy-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: OWNER })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, budget, close };
}

test("budget privacy: import preview does not log payee", async () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const h = await openBudgetHttp();
  try {
    const acct = h.budget.createAccount({ name: "Checking", type: "checking" });
    const csv = `Date,Description,Amount\n2026-06-01,${PLANT},9.99\n`;
    const prev = await fetch(
      `${h.base}/api/budget/import/preview?accountId=${acct.id}&fileName=x.csv`,
      {
        method: "POST",
        headers: { cookie: "CF_Authorization=t", "x-ah": "1", "content-type": "text/csv" },
        body: csv,
      },
    );
    assert.equal(prev.status, 200);
    assert.ok(!JSON.stringify(errors).includes(PLANT));
  } finally {
    console.error = orig;
    await h.close();
  }
});

test("budget privacy: logBudgetError strips planted payee from detail", () => {
  const lines: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    logBudgetError("validation", { code: "x", payee: PLANT, route: "/api/budget/import/preview" });
    const blob = JSON.stringify(lines);
    assert.ok(!blob.includes(PLANT));
    assert.match(blob, /validation/);
  } finally {
    console.error = orig;
  }
});

test("budget privacy: MCP and LLM paths exclude budget modules", () => {
  const mcpServer = readFileSync(join(process.cwd(), "src/mcp/create-server.ts"), "utf8");
  const mcpActions = readFileSync(join(process.cwd(), "src/mcp/actions.ts"), "utf8");
  assert.ok(!mcpServer.includes("budget"));
  assert.ok(!mcpActions.includes("BudgetStore"));
  const webhook = readFileSync(join(process.cwd(), "src/integrations/power-automate.ts"), "utf8");
  assert.ok(!webhook.includes("budget"));
  const llmNotes = notesForLlmContext([]);
  assert.ok(!JSON.stringify(llmNotes).includes(PLANT));
});

test("budget privacy: seeded budget payee absent from knowledge LLM note context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-llm-"));
  const budget = BudgetStore.open(dir);
  const acct = budget.createAccount({ name: "Checking", type: "checking" });
  const fp = transactionFingerprint(acct.id, "2026-08-01", -999, PLANT, 0);
  budget.commitImport({
    accountId: acct.id,
    fileName: "x.csv",
    fileSha256: "abc",
    mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD", amountColumn: "Amount" },
    invertSign: false,
    rows: [
      {
        rowNumber: 2,
        date: "2026-08-01",
        amountCents: -999,
        payee: PLANT,
        memo: "",
        categoryId: null,
        fingerprint: fp,
      },
    ],
  });
  const notes = await NotesStore.open(dir);
  const contextJson = JSON.stringify(notesForLlmContext(notes.listNotes()));
  assert.ok(!contextJson.includes(PLANT));
  budget.close();
  await rm(dir, { recursive: true, force: true });
});

test("budget privacy: service worker skips /budget caching", () => {
  assert.match(SERVICE_WORKER, /url\.pathname === "\/budget"/);
  assert.match(SERVICE_WORKER, /startsWith\("\/budget\/"\)/);
});

test("budget privacy: non-owner cannot read budget API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-owner-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    ADMIN_TOKEN: "x".repeat(32),
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: "other@example.com" })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/budget/accounts`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 403);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget privacy: anonymous request returns 401", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-anon-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    ADMIN_TOKEN: "z".repeat(32),
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/budget/accounts`, { headers: { "x-ah": "1" } });
    assert.equal(res.status, 401);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("budget privacy: admin token without owner email returns 403", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-admin-"));
  const admin = "a".repeat(32);
  const cfg = loadConfig({
    DATA_DIR: dir,
    ADMIN_TOKEN: admin,
    CF_ACCESS_TEAM_DOMAIN: "team.example.com",
    CF_ACCESS_AUD: "aud",
    OWNER_EMAILS: OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = BudgetStore.open(dir);
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/budget/accounts`, {
      headers: { authorization: `Bearer ${admin}`, "x-ah": "1" },
    });
    assert.equal(res.status, 403);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});
