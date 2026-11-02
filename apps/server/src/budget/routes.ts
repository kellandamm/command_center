import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import { readRawBody } from "../request-body";
import type { AuthResult } from "../auth";
import { BUDGET_IMPORT_MAX_BYTES, BUDGET_PREVIEW_SAMPLE_ROWS, DATE_FORMATS } from "./constants";
import {
  detectHeaderRow,
  guessMapping,
  normalizeImportRows,
  parseCsv,
  stripBom,
  suggestInvertSign,
  transactionFingerprint,
  normalizePayee,
  type CsvMapping,
} from "./csv";
import { budgetAvailable, BUDGET_DISABLED_MESSAGE } from "./gate";
import { isBudgetOwner } from "./owner-access";
import { importPreviewCache } from "./import-preview-cache";
import { logBudgetError } from "./redact";
import { BudgetStore, type BudgetAccount } from "./store";
import type { AccountType } from "./constants";
import { computeRollup, monthKey, parseBudgetMonth } from "./rollup";
import { budgetExportCsvLines } from "./csv-export";
import { handleSubscriptionRoutes } from "./subscription-routes";
import { runSubscriptionDetection } from "./subscriptions/detect";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function accountForApi(store: BudgetStore, account: BudgetAccount) {
  const profile = store.getCsvProfile(account.id);
  return {
    ...account,
    importDateFormat: profile?.dateFormat ?? null,
    balanceCents: store.accountBalanceCents(account),
  };
}

export async function handleBudgetRoutes(
  store: BudgetStore | undefined,
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  who: AuthResult & { ok: true },
  url: URL,
  readJson: () => Promise<unknown>,
): Promise<boolean> {
  if (!path.startsWith("/api/budget")) return false;

  if (!budgetAvailable(cfg)) {
    json(res, 503, { error: BUDGET_DISABLED_MESSAGE });
    return true;
  }
  if (!store) {
    json(res, 503, { error: BUDGET_DISABLED_MESSAGE });
    return true;
  }
  if (!isBudgetOwner(who)) {
    json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
    return true;
  }

  const ownerEmail = who.email!;

  try {
    if (await handleSubscriptionRoutes(store, cfg, req, res, path, readJson)) {
      return true;
    }

    if (path === "/api/budget/accounts" && req.method === "GET") {
      json(res, 200, { accounts: store.listAccounts().map((a) => accountForApi(store, a)) });
      return true;
    }
    if (path === "/api/budget/accounts" && req.method === "POST") {
      const body = (await readJson()) as Record<string, unknown>;
      const type = String(body.type ?? "checking") as AccountType;
      const account = store.createAccount({
        name: String(body.name ?? ""),
        type,
        institution: body.institution != null ? String(body.institution) : undefined,
        last4: body.last4 != null ? String(body.last4) : undefined,
        openingBalanceCents: body.openingBalanceCents != null ? Number(body.openingBalanceCents) : undefined,
        openingDate: body.openingDate != null ? String(body.openingDate) : undefined,
        currentBalanceCents: body.currentBalanceCents != null ? Number(body.currentBalanceCents) : undefined,
        invertSign: Boolean(body.invertSign),
      });
      json(res, 201, { account: accountForApi(store, account) });
      return true;
    }

    const accountMatch = path.match(/^\/api\/budget\/accounts\/([^/]+)$/);
    if (accountMatch && req.method === "PATCH") {
      const body = (await readJson()) as Record<string, unknown>;
      const account = store.updateAccount(decodeURIComponent(accountMatch[1]!), {
        name: body.name != null ? String(body.name) : undefined,
        institution: body.institution !== undefined ? (body.institution == null ? null : String(body.institution)) : undefined,
        last4: body.last4 !== undefined ? (body.last4 == null ? null : String(body.last4)) : undefined,
        openingBalanceCents: body.openingBalanceCents != null ? Number(body.openingBalanceCents) : undefined,
        openingDate: body.openingDate !== undefined ? (body.openingDate == null ? null : String(body.openingDate)) : undefined,
        currentBalanceCents: body.currentBalanceCents != null ? Number(body.currentBalanceCents) : undefined,
        invertSign: body.invertSign != null ? Boolean(body.invertSign) : undefined,
        archived: body.archived != null ? Boolean(body.archived) : undefined,
      });
      if (!account) {
        json(res, 404, { error: "not found" });
        return true;
      }
      json(res, 200, { account: accountForApi(store, account) });
      return true;
    }

    if (path === "/api/budget/categories" && req.method === "GET") {
      json(res, 200, { groups: store.listCategoryGroups(), categories: store.listCategories() });
      return true;
    }

    if (path === "/api/budget/transactions" && req.method === "GET") {
      const accountId = url.searchParams.get("accountId") ?? undefined;
      json(res, 200, { transactions: store.listTransactions(accountId) });
      return true;
    }

    if (path === "/api/budget/rollup" && req.method === "GET") {
      const monthParam = url.searchParams.get("month");
      if (monthParam && !parseBudgetMonth(monthParam)) {
        json(res, 400, { error: "invalid month" });
        return true;
      }
      const month = monthParam ?? monthKey(new Date(), cfg.tz);
      json(res, 200, { rollup: computeRollup(store, cfg, month) });
      return true;
    }

    if (path === "/api/budget/net-worth" && req.method === "GET") {
      const nw = store.netWorth();
      json(res, 200, {
        totalCents: nw.totalCents,
        equityLabel: "Equity coming soon",
        accounts: nw.accounts,
      });
      return true;
    }

    if (path === "/api/budget/budget-months" && req.method === "GET") {
      const monthParam = url.searchParams.get("month");
      if (monthParam && !parseBudgetMonth(monthParam)) {
        json(res, 400, { error: "invalid month" });
        return true;
      }
      const month = monthParam ?? monthKey(new Date(), cfg.tz);
      json(res, 200, { month, rows: store.listBudgetMonth(month) });
      return true;
    }

    if (path === "/api/budget/budget-months" && req.method === "PUT") {
      const body = (await readJson()) as Record<string, unknown>;
      const month = String(body.month ?? monthKey(new Date(), cfg.tz));
      if (!parseBudgetMonth(month)) {
        json(res, 400, { error: "invalid month" });
        return true;
      }
      const categoryId = String(body.categoryId ?? "");
      const budgetedCents = Number(body.budgetedCents);
      store.setBudgetMonth(month, categoryId, budgetedCents);
      json(res, 200, { month, categoryId, budgetedCents });
      return true;
    }

    if (path === "/api/budget/settings" && req.method === "GET") {
      json(res, 200, { settings: store.getBudgetPrefs() });
      return true;
    }

    if (path === "/api/budget/settings" && req.method === "PUT") {
      const body = (await readJson()) as Record<string, unknown>;
      const settings = store.setBudgetPrefs({
        overBudgetNotify: body.overBudgetNotify != null ? Boolean(body.overBudgetNotify) : undefined,
      });
      json(res, 200, { settings });
      return true;
    }

    if (path === "/api/budget/export.json" && req.method === "GET") {
      json(res, 200, store.exportSnapshot());
      return true;
    }

    if (path === "/api/budget/export.csv" && req.method === "GET") {
      const snap = store.exportSnapshot();
      const lines = budgetExportCsvLines(snap.accounts, snap.transactions);
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="budget-export.csv"',
      });
      res.end(lines.join("\n"));
      return true;
    }

    if (path === "/api/budget/delete-all" && req.method === "POST") {
      const body = (await readJson()) as Record<string, unknown>;
      if (String(body.confirm ?? "") !== "DELETE ALL BUDGET DATA") {
        json(res, 400, { error: "confirmation required" });
        return true;
      }
      importPreviewCache.clearForOwner(ownerEmail);
      store.deleteAllData();
      json(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/budget/transactions" && req.method === "POST") {
      const body = (await readJson()) as Record<string, unknown>;
      const tx = store.createTransaction({
        accountId: String(body.accountId ?? ""),
        date: String(body.date ?? ""),
        amountCents: Number(body.amountCents),
        payee: body.payee != null ? String(body.payee) : undefined,
        memo: body.memo != null ? String(body.memo) : undefined,
        categoryId: body.categoryId !== undefined ? (body.categoryId == null ? null : String(body.categoryId)) : undefined,
      });
      json(res, 201, { transaction: tx });
      return true;
    }

    if (path === "/api/budget/import/batches" && req.method === "GET") {
      json(res, 200, { batches: store.listImportBatches() });
      return true;
    }

    const undoMatch = path.match(/^\/api\/budget\/import\/undo\/([^/]+)$/);
    if (undoMatch && req.method === "POST") {
      const batchId = decodeURIComponent(undoMatch[1]!);
      const batch = store.getImportBatch(batchId);
      if (!batch) {
        json(res, 404, { error: "batch not found" });
        return true;
      }
      importPreviewCache.clearForOwner(ownerEmail);
      const undone = store.undoImport(batchId);
      json(res, 200, { batch: undone });
      return true;
    }

    if (path === "/api/budget/import/preview" && req.method === "POST") {
      const accountId = url.searchParams.get("accountId") ?? "";
      let fileName = url.searchParams.get("fileName");
      if (fileName && fileName.length > 200) fileName = fileName.slice(0, 200);
      const account = store.getAccount(accountId);
      if (!account) {
        json(res, 404, { error: "account not found" });
        return true;
      }
      if (account.type === "investment") {
        json(res, 400, { error: "investment accounts cannot import CSV" });
        return true;
      }
      let raw: Buffer;
      try {
        raw = await readRawBody(req, BUDGET_IMPORT_MAX_BYTES);
      } catch (err) {
        if (err instanceof ValidationError && err.message.includes("too large")) {
          json(res, 413, { error: "file too large" });
          return true;
        }
        throw err;
      }
      const fileSha256 = BudgetStore.sha256(raw);
      const text = stripBom(raw.toString("utf8"));
      const table = parseCsv(text);
      if (!table.length) {
        json(res, 400, { error: "empty file" });
        return true;
      }
      const headerIdx = detectHeaderRow(table);
      const headers = table[headerIdx]!;
      const dataRows = table.slice(headerIdx + 1).filter((r) => r.some((c) => c.trim()));
      if (dataRows.length > 20_000) {
        json(res, 400, { error: "too many rows" });
        return true;
      }
      const saved = store.getCsvProfile(accountId);
      const mapping: CsvMapping = saved ?? guessMapping(headers);
      let invertSign = account.invertSign;
      const bodyMapping = url.searchParams.get("mapping");
      if (bodyMapping) {
        try {
          Object.assign(mapping, JSON.parse(bodyMapping) as CsvMapping);
        } catch {
          json(res, 400, { error: "invalid mapping" });
          return true;
        }
      }
      const dateFormatParam = url.searchParams.get("dateFormat");
      if (dateFormatParam && (DATE_FORMATS as readonly string[]).includes(dateFormatParam)) {
        mapping.dateFormat = dateFormatParam as CsvMapping["dateFormat"];
      }

      const trialRows = normalizeImportRows({
        accountId,
        mapping,
        invertSign: false,
        headers,
        dataRows,
        headerRowIndex: headerIdx,
        categoryByName: store.categoryNameMap(),
        applyPayeeRules: (payee) => store.applyPayeeRule(payee),
      });
      const suggestInvert =
        account.type === "credit" &&
        !account.invertSign &&
        suggestInvertSign(trialRows.filter((r) => !r.error).map((r) => r.amountCents));

      const preRows = normalizeImportRows({
        accountId,
        mapping,
        invertSign,
        headers,
        dataRows,
        headerRowIndex: headerIdx,
        categoryByName: store.categoryNameMap(),
        applyPayeeRules: (payee) => store.applyPayeeRule(payee),
      });
      const previewId = importPreviewCache.put(ownerEmail, {
        ownerEmail,
        accountId,
        fileName,
        fileSha256,
        mapping,
        invertSign,
        rows: preRows,
      });

      const counts = store.classifyImportRows(accountId, preRows);
      json(res, 200, {
        previewId,
        mapping,
        invertSign,
        suggestInvertSign: suggestInvert,
        fileSha256,
        counts,
        sample: preRows.slice(0, BUDGET_PREVIEW_SAMPLE_ROWS).map((r) => ({
          rowNumber: r.rowNumber,
          date: r.date,
          amountCents: r.amountCents,
          payee: r.payee,
          memo: r.memo,
          categoryId: r.categoryId,
          status: r.error ? "error" : store.fingerprintExists(accountId, r.fingerprint) ? "duplicate" : "new",
          error: r.error,
        })),
      });
      return true;
    }

    if (path === "/api/budget/import/commit" && req.method === "POST") {
      const body = (await readJson()) as Record<string, unknown>;
      const previewId = String(body.previewId ?? "");
      const entry = importPreviewCache.get(ownerEmail, previewId);
      if (!entry) {
        json(res, 404, { error: "preview expired or not found" });
        return true;
      }
      let invertSign = body.invertSign != null ? Boolean(body.invertSign) : entry.invertSign;
      if (body.mapping && typeof body.mapping === "object") {
        if (JSON.stringify(body.mapping) !== JSON.stringify(entry.mapping)) {
          json(res, 400, { error: "mapping cannot change after preview" });
          return true;
        }
      }

      let commitRows = entry.rows;
      if (invertSign !== entry.invertSign) {
        const dupCounts = new Map<string, number>();
        commitRows = entry.rows.map((r) => {
          if (r.error) return r;
          const amountCents = -r.amountCents;
          const dupKey = `${r.date}|${amountCents}|${normalizePayee(r.payee)}`;
          const nth = dupCounts.get(dupKey) ?? 0;
          dupCounts.set(dupKey, nth + 1);
          return {
            ...r,
            amountCents,
            fingerprint: transactionFingerprint(entry.accountId, r.date, amountCents, r.payee, nth),
          };
        });
      }

      const batch = store.commitImport({
        accountId: entry.accountId,
        fileName: entry.fileName,
        fileSha256: entry.fileSha256,
        mapping: entry.mapping,
        invertSign,
        rows: commitRows,
      });
      importPreviewCache.delete(ownerEmail, previewId);
      runSubscriptionDetection(store, cfg);
      json(res, 201, { batch });
      return true;
    }

    json(res, 404, { error: "not found" });
    return true;
  } catch (err) {
    if (err instanceof ValidationError) {
      logBudgetError("validation", { code: "validation" });
      const msg = err.message.includes("too large") ? 413 : 400;
      json(res, msg, { error: msg === 413 ? "file too large" : "invalid request" });
      return true;
    }
    logBudgetError("route_error", { route: path.replace(/\?.*$/, "") });
    json(res, 500, { error: "budget request failed" });
    return true;
  }
}
