import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config";
import { makeAuthenticator } from "../src/auth";
import { createApp } from "../src/http";
import { DailyBriefingService } from "../src/daily-briefing/service";
import { SettingsStore } from "../src/settings";
import { NotesStore } from "../src/notes/store";
import { BudgetStore } from "../src/budget/store";
import { closeIntegrationServer, openIntegrationStores } from "./helpers";

const OWNER = "owner@example.com";
const PLANT = "PLANT_SECRET_PAYEE";

async function openBudgetHttp() {
  const dir = await mkdtemp(join(tmpdir(), "cc-budget-import-"));
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

const headers = { cookie: "CF_Authorization=t", "x-ah": "1", "content-type": "application/json" };

test("budget import: re-import same file adds zero rows; twin rows both insert", async () => {
  const h = await openBudgetHttp();
  try {
    const acctRes = await fetch(`${h.base}/api/budget/accounts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Checking", type: "checking" }),
    });
    const { account } = (await acctRes.json()) as { account: { id: string } };
    const dupCsv = `Date,Description,Amount\n05/01/2026,Duplicate,-15.00\n05/01/2026,Duplicate,-15.00\n`;

    async function importCsv(csv: string, invertSign = false) {
      const prev = await fetch(
        `${h.base}/api/budget/import/preview?accountId=${account.id}&fileName=t.csv`,
        { method: "POST", headers: { ...headers, "content-type": "text/csv" }, body: csv },
      );
      const preview = (await prev.json()) as { previewId: string; counts: { newCount: number } };
      assert.equal(prev.status, 200, JSON.stringify(preview));
      assert.ok(preview.previewId);
      const commit = await fetch(`${h.base}/api/budget/import/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ previewId: preview.previewId, invertSign }),
      });
      const body = (await commit.json()) as { batch: { rowsAdded: number }; error?: string };
      assert.equal(commit.status, 201, body.error ?? JSON.stringify(body));
      return body;
    }

    const twin = await importCsv(dupCsv);
    assert.equal(twin.batch.rowsAdded, 2);

    const first = await importCsv(`Date,Description,Amount\n04/01/2026,${PLANT},-25.00\n04/02/2026,Other,-10.00\n`);
    assert.ok(first.batch.rowsAdded >= 1);
    const again = await importCsv(`Date,Description,Amount\n04/01/2026,${PLANT},-25.00\n04/02/2026,Other,-10.00\n`);
    assert.equal(again.batch.rowsAdded, 0);

    const overlap = await importCsv(`Date,Description,Amount\n04/01/2026,${PLANT},-25.00\n`);
    assert.equal(overlap.batch.rowsAdded, 0);
  } finally {
    await h.close();
  }
});

test("budget import: inverted credit account re-import adds zero rows", async () => {
  const h = await openBudgetHttp();
  try {
    const acctRes = await fetch(`${h.base}/api/budget/accounts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Visa", type: "credit", invertSign: true }),
    });
    const { account } = (await acctRes.json()) as { account: { id: string; invertSign: boolean } };
    assert.equal(account.invertSign, true);
    const csv = `Date,Description,Amount\n06/01/2026,Charge,-40.00\n`;

    async function importOnce() {
      const prev = await fetch(
        `${h.base}/api/budget/import/preview?accountId=${account.id}&fileName=card.csv`,
        { method: "POST", headers: { ...headers, "content-type": "text/csv" }, body: csv },
      );
      const preview = (await prev.json()) as {
        previewId: string;
        invertSign: boolean;
        counts: { newCount: number };
      };
      assert.equal(prev.status, 200);
      assert.equal(preview.invertSign, true);
      const commit = await fetch(`${h.base}/api/budget/import/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ previewId: preview.previewId, invertSign: true }),
      });
      const body = (await commit.json()) as { batch: { rowsAdded: number } };
      assert.equal(commit.status, 201);
      return body.batch.rowsAdded;
    }

    assert.equal(await importOnce(), 1);
    assert.equal(await importOnce(), 0);
    const acct = h.budget.getAccount(account.id);
    assert.equal(acct?.invertSign, true);
  } finally {
    await h.close();
  }
});

test("budget import: mapping change at commit is rejected", async () => {
  const h = await openBudgetHttp();
  try {
    const { account } = (await (
      await fetch(`${h.base}/api/budget/accounts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Checking", type: "checking" }),
      })
    ).json()) as { account: { id: string } };
    const csv = `Date,Description,Amount\n07/01/2026,Test,-1.00\n`;
    const prev = await fetch(
      `${h.base}/api/budget/import/preview?accountId=${account.id}&fileName=t.csv`,
      { method: "POST", headers: { ...headers, "content-type": "text/csv" }, body: csv },
    );
    const preview = (await prev.json()) as { previewId: string; mapping: Record<string, string> };
    const commit = await fetch(`${h.base}/api/budget/import/commit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        previewId: preview.previewId,
        mapping: { ...preview.mapping, dateColumn: "Wrong" },
      }),
    });
    assert.equal(commit.status, 400);
  } finally {
    await h.close();
  }
});

test("budget import: oversize file returns 413", async () => {
  const h = await openBudgetHttp();
  try {
    const { account } = (await (
      await fetch(`${h.base}/api/budget/accounts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Checking", type: "checking" }),
      })
    ).json()) as { account: { id: string } };
    const big = "a".repeat(5_000_001);
    const prev = await fetch(
      `${h.base}/api/budget/import/preview?accountId=${account.id}&fileName=big.csv`,
      { method: "POST", headers: { ...headers, "content-type": "text/csv" }, body: big },
    );
    assert.equal(prev.status, 413);
  } finally {
    await h.close();
  }
});

test("budget import: saved DD/MM profile applies when dateFormat param omitted", async () => {
  const h = await openBudgetHttp();
  try {
    const { account } = (await (
      await fetch(`${h.base}/api/budget/accounts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "EU Checking", type: "checking" }),
      })
    ).json()) as { account: { id: string } };
    const csv = `Date,Description,Amount\n15/03/2026,Pay,-10.00\n`;

    const seedPreview = await fetch(
      `${h.base}/api/budget/import/preview?accountId=${account.id}&fileName=seed.csv&dateFormat=DD/MM/YYYY`,
      { method: "POST", headers: { ...headers, "content-type": "text/csv" }, body: csv },
    );
    const seed = (await seedPreview.json()) as { previewId: string; mapping: { dateFormat: string } };
    assert.equal(seedPreview.status, 200);
    assert.equal(seed.mapping.dateFormat, "DD/MM/YYYY");
    const seedCommit = await fetch(`${h.base}/api/budget/import/commit`, {
      method: "POST",
      headers,
      body: JSON.stringify({ previewId: seed.previewId }),
    });
    assert.equal(seedCommit.status, 201);

    const again = await fetch(
      `${h.base}/api/budget/import/preview?accountId=${account.id}&fileName=seed.csv`,
      { method: "POST", headers: { ...headers, "content-type": "text/csv" }, body: csv },
    );
    const preview = (await again.json()) as {
      mapping: { dateFormat: string };
      sample: Array<{ date: string; error?: string; status: string }>;
    };
    assert.equal(again.status, 200);
    assert.equal(preview.mapping.dateFormat, "DD/MM/YYYY");
    assert.equal(preview.sample[0]?.date, "2026-03-15");
    assert.notEqual(preview.sample[0]?.status, "error");

    const acctRes = await fetch(`${h.base}/api/budget/accounts`, { headers });
    const listed = (await acctRes.json()) as { accounts: Array<{ id: string; importDateFormat: string | null }> };
    const row = listed.accounts.find((a) => a.id === account.id);
    assert.equal(row?.importDateFormat, "DD/MM/YYYY");
  } finally {
    await h.close();
  }
});

test("budget import: revert guard — forcing MM/DD over saved profile must fail", () => {
  const src = readFileSync(join(process.cwd(), "src/budget/routes.ts"), "utf8");
  assert.match(src, /dateFormatParam && \(DATE_FORMATS/);
  assert.doesNotMatch(src, /mapping\.dateFormat\s*=\s*"MM\/DD\/YYYY"/);
});
