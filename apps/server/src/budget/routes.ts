import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import { readRawBody } from "../request-body";
import type { AuthResult } from "../auth";
import { BUDGET_IMPORT_MAX_BYTES, BUDGET_PREVIEW_SAMPLE_ROWS } from "./constants";
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
import { importPreviewCache } from "./import-preview-cache";
import { logBudgetError } from "./redact";
import { BudgetStore } from "./store";
import type { AccountType } from "./constants";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function ownerOk(who: AuthResult & { ok: true }): boolean {
  return who.owner === true && Boolean(who.email);
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
  if (!ownerOk(who)) {
    json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
    return true;
  }

  const ownerEmail = who.email!;

  try {
    if (path === "/api/budget/accounts" && req.method === "GET") {
      json(res, 200, { accounts: store.listAccounts() });
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
      json(res, 201, { account });
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
      json(res, 200, { account });
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
      const previewId = url.searchParams.get("previewId");
      if (previewId) importPreviewCache.delete(ownerEmail, previewId);
      const undone = store.undoImport(batchId);
      json(res, 200, { batch: undone });
      return true;
    }

    if (path === "/api/budget/import/preview" && req.method === "POST") {
      const accountId = url.searchParams.get("accountId") ?? "";
      const fileName = url.searchParams.get("fileName");
      const account = store.getAccount(accountId);
      if (!account) {
        json(res, 404, { error: "account not found" });
        return true;
      }
      if (account.type === "investment") {
        json(res, 400, { error: "investment accounts cannot import CSV" });
        return true;
      }
      const raw = await readRawBody(req, BUDGET_IMPORT_MAX_BYTES);
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
      if (bodyMapping) Object.assign(mapping, JSON.parse(bodyMapping) as CsvMapping);

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
      let invertSign = entry.invertSign;
      if (body.invertSign != null) invertSign = Boolean(body.invertSign);
      if (body.mapping && typeof body.mapping === "object") {
        entry.mapping = { ...entry.mapping, ...(body.mapping as CsvMapping) };
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
      json(res, 201, { batch });
      return true;
    }

    json(res, 404, { error: "not found" });
    return true;
  } catch (err) {
    if (err instanceof ValidationError) {
      logBudgetError("validation", { code: "validation" });
      json(res, 400, { error: "invalid request" });
      return true;
    }
    logBudgetError("route_error", { route: path.replace(/\?.*$/, "") });
    json(res, 500, { error: "budget request failed" });
    return true;
  }
}
