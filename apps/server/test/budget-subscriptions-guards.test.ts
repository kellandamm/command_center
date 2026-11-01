import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import { budgetAvailable } from "../src/budget/gate";
import { budgetPage } from "../src/ui/budget-page";
import { BUDGET_DATABASE_FILE } from "../src/budget/constants";
import { STANDARD_CONFIDENCE_THRESHOLD, POSSIBLE_YEARLY_CONFIDENCE_THRESHOLD } from "../src/budget/subscriptions/types";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";
const PLANT = "PLANT_SECRET_PAYEE";

async function subHttp(opts: { ownerEmail?: string; gateOff?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-guards-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    ALLOW_INSECURE_NO_AUTH: "1",
    CF_ACCESS_TEAM_DOMAIN: opts.gateOff ? "" : "team.example.com",
    CF_ACCESS_AUD: opts.gateOff ? "" : "aud",
    OWNER_EMAILS: opts.gateOff ? "" : OWNER,
    TZ: "UTC",
  });
  const settings = new SettingsStore(dir);
  await settings.load();
  const dailyBriefing = await DailyBriefingService.open(dir, cfg.tz);
  const notes = await NotesStore.open(dir);
  const integration = await openIntegrationStores(dir, cfg);
  const budget = budgetAvailable(cfg) ? BudgetStore.open(dir) : undefined;
  const server = createApp({
    cfg,
    auth: makeAuthenticator(cfg, async () => ({ email: opts.ownerEmail ?? OWNER })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    budget?.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  };
  return { base, close };
}

test("subscriptions guard: gate off returns 503 before owner check", async () => {
  const h = await subHttp({ gateOff: true, ownerEmail: OWNER });
  try {
    const res = await fetch(`${h.base}/api/budget/subscriptions`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 503);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: non-owner gets 403 on subscriptions API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-nonowner-"));
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
    auth: makeAuthenticator(cfg, async () => ({ email: "guest@example.com" })),
    settings,
    dailyBriefing,
    notes,
    ...integration,
    budget,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/budget/subscriptions`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 403);
  } finally {
    budget.close();
    await closeIntegrationServer(server, integration);
    await rm(dir, { recursive: true, force: true });
  }
});

test("subscriptions guard: owner GET uses cache-control no-store", async () => {
  const h = await subHttp({});
  try {
    const res = await fetch(`${h.base}/api/budget/subscriptions`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("cache-control")), /no-store/);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: scan POST requires CSRF header", async () => {
  const h = await subHttp({});
  try {
    const res = await fetch(`${h.base}/api/budget/subscriptions/scan`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    });
    assert.equal(res.status, 403);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: shutdown briefing path has no subscription imports", () => {
  const shutdown = readFileSync(join(process.cwd(), "src/briefing/shutdown-service.ts"), "utf8");
  assert.ok(!shutdown.includes("subscription"));
  assert.ok(!shutdown.includes("Subscription"));
});

test("subscriptions guard: budget routes enforce isBudgetOwner via shared helper", () => {
  const routes = readFileSync(join(process.cwd(), "src/budget/routes.ts"), "utf8");
  assert.match(routes, /isBudgetOwner\(who\)/);
  const subRoutes = readFileSync(join(process.cwd(), "src/budget/subscription-routes.ts"), "utf8");
  assert.ok(!subRoutes.includes("canManageSharedServerState"));
});

async function openOwnerBudgetWithStore() {
  const dir = await mkdtemp(join(tmpdir(), "cc-sub-guards-store-"));
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
  return { base, budget, close, dir };
}

test("subscriptions guard: scan logs via logBudgetError without payee (multi-charge path)", async () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const h = await openOwnerBudgetWithStore();
  try {
    const acct = h.budget.createAccount({ name: "Checking", type: "checking" });
    const base = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 60 + i * 31);
      h.budget.createTransaction({
        accountId: acct.id,
        date: d.toISOString().slice(0, 10),
        amountCents: -999,
        payee: PLANT,
      });
    }
    (h.budget as BudgetStore & { listOutflowChargesSince: () => never }).listOutflowChargesSince = () => {
      throw new Error(`${PLANT} leak`);
    };
    const res = await fetch(`${h.base}/api/budget/subscriptions/scan`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: "{}",
    });
    assert.equal(res.status, 200);
    const blob = JSON.stringify(errors);
    assert.ok(!blob.includes(PLANT));
    assert.match(blob, /subscription_scan_failed|budget:/);
  } finally {
    console.error = orig;
    await h.close();
  }
});

test("subscriptions guard: subscriptions module has no LLM or ntfy imports", () => {
  const detect = readFileSync(join(process.cwd(), "src/budget/subscriptions/detect.ts"), "utf8");
  const due = readFileSync(join(process.cwd(), "src/budget/subscriptions/due.ts"), "utf8");
  const routes = readFileSync(join(process.cwd(), "src/budget/subscription-routes.ts"), "utf8");
  for (const src of [detect, due, routes]) {
    assert.ok(!src.includes("llm/"));
    assert.ok(!src.includes("daily-briefing"));
    assert.ok(!src.includes("ntfy"));
    assert.ok(!src.includes("notify/"));
  }
});

test("subscriptions guard: budget page subscriptions tables use textContent (XSS)", () => {
  const html = budgetPage([], { owner: true, initialView: "subscriptions" });
  assert.match(html, /tdName\.textContent/);
  assert.match(html, /textCell\(tr,s\.displayName\)/);
  assert.match(html, /budget-sub-next-due/);
  assert.match(html, /deactivateConflictingActive/);
  assert.doesNotMatch(html, /innerHTML\s*=\s*d\.displayName/);
});

test("subscriptions guard: import commit triggers subscription scan", () => {
  const routes = readFileSync(join(process.cwd(), "src/budget/routes.ts"), "utf8");
  assert.match(routes, /runSubscriptionDetection\(store, cfg\)/);
});

test("subscriptions guard: outflows exclude transfers in SQL", () => {
  const store = readFileSync(join(process.cwd(), "src/budget/store.ts"), "utf8");
  assert.match(store, /transfer_account_id IS NULL/);
});

test("subscriptions guard: delete-all clears subscription tables", async () => {
  const h = await openOwnerBudgetWithStore();
  try {
    const cat = h.budget.listCategories()[0]!.id;
    h.budget.createSubscriptionManual({
      displayName: "Test",
      payee: "test",
      amountCents: -100,
      cadence: "monthly",
      anchorDate: "2025-01-01",
      categoryId: cat,
    });
    h.budget.insertDetection({
      id: "d1",
      payeeNormalized: "x",
      displayName: "x",
      amountCents: -100,
      cadence: "monthly",
      detectionKind: "standard",
      confidence: 0.9,
      sampleDates: ["2025-01-01"],
      laneKey: "x|monthly|100",
    });
    const res = await fetch(`${h.base}/api/budget/delete-all`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ confirm: "DELETE ALL BUDGET DATA" }),
    });
    assert.equal(res.status, 200);
    assert.equal(h.budget.listSubscriptions(true).length, 0);
    assert.equal(h.budget.listPendingDetections().length, 0);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: confirm requires category id", async () => {
  const h = await openOwnerBudgetWithStore();
  try {
    h.budget.insertDetection({
      id: "d2",
      payeeNormalized: "svc",
      displayName: "svc",
      amountCents: -500,
      cadence: "monthly",
      detectionKind: "standard",
      confidence: 0.9,
      sampleDates: ["2025-01-01", "2025-02-01", "2025-03-01"],
      laneKey: "svc|monthly|500",
    });
    const res = await fetch(`${h.base}/api/budget/subscriptions/detections/d2/confirm`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ categoryId: "" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: multi-charge PLANT scan never logs payee on success", async () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const h = await openOwnerBudgetWithStore();
  try {
    const acct = h.budget.createAccount({ name: "Checking", type: "checking" });
    const base = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 90 + i * 31);
      h.budget.createTransaction({
        accountId: acct.id,
        date: d.toISOString().slice(0, 10),
        amountCents: -999,
        payee: PLANT,
      });
    }
    const res = await fetch(`${h.base}/api/budget/subscriptions/scan`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: "{}",
    });
    assert.equal(res.status, 200);
    const blob = JSON.stringify(errors);
    assert.ok(!blob.includes(PLANT));
  } finally {
    console.error = orig;
    await h.close();
  }
});

test("subscriptions guard: invalid anchor on POST returns 400", async () => {
  const h = await openOwnerBudgetWithStore();
  try {
    const cat = h.budget.listCategories()[0]!.id;
    const res = await fetch(`${h.base}/api/budget/subscriptions`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({
        displayName: "Bad",
        payee: "bad",
        amountCents: -500,
        cadence: "monthly",
        anchorDate: "2026-99-99",
        categoryId: cat,
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: invalid anchor on PUT returns 400", async () => {
  const h = await openOwnerBudgetWithStore();
  try {
    const cat = h.budget.listCategories()[0]!.id;
    const sub = h.budget.createSubscriptionManual({
      displayName: "Ok",
      payee: "ok",
      amountCents: -500,
      cadence: "monthly",
      anchorDate: "2025-01-01",
      categoryId: cat,
    });
    const res = await fetch(`${h.base}/api/budget/subscriptions/${encodeURIComponent(sub.id)}`, {
      method: "PUT",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ anchorDate: "not-a-date" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await h.close();
  }
});

test("subscriptions guard: corrupt stored anchor does not 500 list API", async () => {
  const h = await openOwnerBudgetWithStore();
  try {
    const cat = h.budget.listCategories()[0]!.id;
    const sub = h.budget.createSubscriptionManual({
      displayName: "Corrupt",
      payee: "corrupt",
      amountCents: -500,
      cadence: "monthly",
      anchorDate: "2025-01-01",
      categoryId: cat,
    });
    const db = new DatabaseSync(join(h.dir, BUDGET_DATABASE_FILE));
    db.prepare("UPDATE subscriptions SET anchor_date = ? WHERE id = ?").run("979-10-16", sub.id);
    db.close();
    const res = await fetch(`${h.base}/api/budget/subscriptions`, {
      headers: { cookie: "CF_Authorization=t", "x-ah": "1" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      subscriptions: Array<{ id: string; nextDueDate: string }>;
    };
    const row = body.subscriptions.find((s) => s.id === sub.id);
    assert.ok(row);
    assert.equal(row!.nextDueDate, "—");
  } finally {
    await h.close();
  }
});

test("subscriptions guard: create route error path never logs PLANT payee", async () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const h = await openOwnerBudgetWithStore();
  try {
    const cat = h.budget.listCategories()[0]!.id;
    const origCreate = h.budget.createSubscriptionManual.bind(h.budget);
    h.budget.createSubscriptionManual = () => {
      throw new Error(`${PLANT} leak`);
    };
    const res = await fetch(`${h.base}/api/budget/subscriptions`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({
        displayName: "Shown",
        payee: PLANT,
        amountCents: -500,
        cadence: "monthly",
        anchorDate: "2025-01-01",
        categoryId: cat,
      }),
    });
    h.budget.createSubscriptionManual = origCreate;
    assert.equal(res.status, 500);
    const blob = JSON.stringify(errors);
    assert.ok(!blob.includes(PLANT));
    assert.match(blob, /subscription_route_error|budget:/);
  } finally {
    console.error = orig;
    await h.close();
  }
});

test("subscriptions guard: confirm route error path never logs PLANT payee", async () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const h = await openOwnerBudgetWithStore();
  try {
    h.budget.insertDetection({
      id: "d-plant",
      payeeNormalized: "x",
      displayName: "x",
      amountCents: -500,
      cadence: "monthly",
      detectionKind: "standard",
      confidence: 0.9,
      sampleDates: ["2025-01-01", "2025-02-01", "2025-03-01"],
      laneKey: "x|monthly|500",
    });
    const origConfirm = h.budget.confirmDetection.bind(h.budget);
    h.budget.confirmDetection = () => {
      throw new Error(`${PLANT} leak`);
    };
    const res = await fetch(`${h.base}/api/budget/subscriptions/detections/d-plant/confirm`, {
      method: "POST",
      headers: { cookie: "CF_Authorization=t", "content-type": "application/json", "x-ah": "1" },
      body: JSON.stringify({ categoryId: h.budget.listCategories()[0]!.id, payee: PLANT }),
    });
    h.budget.confirmDetection = origConfirm;
    assert.equal(res.status, 500);
    const blob = JSON.stringify(errors);
    assert.ok(!blob.includes(PLANT));
    assert.match(blob, /subscription_route_error|budget:/);
  } finally {
    console.error = orig;
    await h.close();
  }
});

test("subscriptions guard: standard and possible-yearly thresholds are wired", () => {
  assert.equal(STANDARD_CONFIDENCE_THRESHOLD, 0.7);
  assert.equal(POSSIBLE_YEARLY_CONFIDENCE_THRESHOLD, 0.45);
  const detect = readFileSync(join(process.cwd(), "src/budget/subscriptions/detect.ts"), "utf8");
  assert.match(detect, /STANDARD_CONFIDENCE_THRESHOLD/);
  assert.match(detect, /POSSIBLE_YEARLY_CONFIDENCE_THRESHOLD/);
});
