import { createHash } from "node:crypto";
import type { DateFormat } from "./constants";

export interface CsvMapping {
  dateColumn: string;
  dateFormat: DateFormat;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  payeeColumn?: string;
  memoColumn?: string;
  categoryColumn?: string;
}

export interface NormalizedImportRow {
  rowNumber: number;
  date: string;
  amountCents: number;
  payee: string;
  memo: string;
  categoryId: string | null;
  fingerprint: string;
  error?: string;
}

export function normalizePayee(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function transactionFingerprint(
  accountId: string,
  date: string,
  amountCents: number,
  payee: string,
  nth: number,
): string {
  const normalized = normalizePayee(payee);
  const payload = `${accountId}|${date}|${amountCents}|${normalized}|${nth}`;
  return createHash("sha256").update(payload).digest("hex");
}

/** Strip UTF-8 BOM. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** RFC 4180 CSV parser (quoted fields, embedded commas and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length > 1 || row[0] !== "" || rows.length === 0) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      if (text[i] === "\n") i++;
      pushField();
      pushRow();
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  pushField();
  if (row.length) pushRow();
  return rows;
}

function headerScore(row: string[]): number {
  return row.filter((c) => c.trim()).length;
}

export function detectHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (headerScore(rows[i]!) >= 2) return i;
  }
  return 0;
}

function normHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function headerHasToken(headerNorm: string, token: string): boolean {
  return headerNorm === token || headerNorm.split(" ").includes(token);
}

function pickColumn(headers: string[], candidates: string[]): string | undefined {
  const normalized = headers.map((h) => normHeader(h));
  for (const cand of candidates) {
    const idx = normalized.findIndex((h) => headerHasToken(h, cand));
    if (idx >= 0) return headers[idx]!;
  }
  return undefined;
}

export function guessMapping(headers: string[]): CsvMapping {
  const dateColumn =
    pickColumn(headers, ["transaction date", "posted date", "post date", "posted", "date"]) ?? headers[0]!;
  const payeeColumn =
    pickColumn(headers, ["description", "payee", "merchant", "name", "details"]) ?? undefined;
  const memoColumn = pickColumn(headers, ["memo", "notes", "note"]) ?? undefined;
  const categoryColumn = pickColumn(headers, ["category", "type"]) ?? undefined;
  const debitColumn = pickColumn(headers, ["debit", "withdrawal", "out"]) ?? undefined;
  const creditColumn = pickColumn(headers, ["credit", "deposit"]) ?? undefined;
  let amountColumn = pickColumn(headers, ["amount", "transaction amount", "value"]);
  if (debitColumn && creditColumn) amountColumn = undefined;
  if (!amountColumn && !debitColumn) amountColumn = pickColumn(headers, ["amount"]) ?? headers[1];
  return {
    dateColumn,
    dateFormat: "MM/DD/YYYY",
    amountColumn,
    debitColumn,
    creditColumn,
    payeeColumn,
    memoColumn,
    categoryColumn,
  };
}

function isoFromParts(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) return null;
  return iso;
}

export function parseDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (format === "YYYY-MM-DD") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [ys, ms, ds] = s.split("-");
    return isoFromParts(Number(ys), Number(ms), Number(ds));
  }
  const parts = s.split(/[/-]/);
  if (parts.length !== 3) return null;
  let y: number;
  let m: number;
  let d: number;
  if (format === "MM/DD/YYYY") {
    m = Number(parts[0]);
    d = Number(parts[1]);
    y = Number(parts[2]);
  } else {
    d = Number(parts[0]);
    m = Number(parts[1]);
    y = Number(parts[2]);
  }
  if (y < 100) y += 2000;
  return isoFromParts(y, m, d);
}

/** Parse currency to whole cents. Outflows may be negative. Returns null on ambiguous or invalid input. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim();
  if (!s || s === "-") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/[$\s]/g, "");
  if (/[eExX]/.test(s)) return null;

  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    if (comma > dot) {
      if (!/^\d{1,3}(\.\d{3})*,\d+$/.test(s) && !/^\d+,\d+$/.test(s)) return null;
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      if (!/^\d{1,3}(,\d{3})+\.\d+$/.test(s) && !/^\d+\.\d+$/.test(s)) return null;
      s = s.replace(/,/g, "");
    }
  } else if (comma >= 0) {
    const segs = s.split(",");
    if (segs.length === 2 && segs[1]!.length <= 2) s = `${segs[0]!.replace(/\./g, "")}.${segs[1]}`;
    else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, "");
    else if (segs.length === 2 && segs[1]!.length === 3 && /^\d+$/.test(segs[0]!)) return null;
    else return null;
  } else if (dot >= 0) {
    const segs = s.split(".");
    if (segs.length > 2) return null;
    if (segs.length === 2 && segs[1]!.length === 3 && segs[1]![0] !== "0" && /^\d+$/.test(segs[0]!)) return null;
  }

  const match = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1]!;
  const fracRaw = match[2] ?? "";
  if (fracRaw.length > 2) {
    const roundDigit = fracRaw[2]!;
    const base = BigInt(whole) * 100n + BigInt(fracRaw.slice(0, 2).padEnd(2, "0"));
    const cents = roundDigit >= "5" ? base + 1n : base;
    const n = Number(cents);
    return negative ? -n : n;
  }
  const cents = Number(whole) * 100 + Number(fracRaw.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

function columnIndex(headers: string[], name: string | undefined): number {
  if (!name) return -1;
  const target = normHeader(name);
  return headers.findIndex((h) => normHeader(h) === target);
}

export function suggestInvertSign(amounts: number[]): boolean {
  if (!amounts.length) return false;
  const positive = amounts.filter((a) => a > 0).length;
  return positive / amounts.length > 0.6;
}

export interface NormalizeOptions {
  accountId: string;
  mapping: CsvMapping;
  invertSign: boolean;
  headers: string[];
  dataRows: string[][];
  headerRowIndex: number;
  categoryByName: Map<string, string>;
  applyPayeeRules: (payee: string) => string | null;
}

export function normalizeImportRows(opts: NormalizeOptions): NormalizedImportRow[] {
  const dateIdx = columnIndex(opts.headers, opts.mapping.dateColumn);
  const amountIdx = columnIndex(opts.headers, opts.mapping.amountColumn);
  const debitIdx = columnIndex(opts.headers, opts.mapping.debitColumn);
  const creditIdx = columnIndex(opts.headers, opts.mapping.creditColumn);
  const payeeIdx = columnIndex(opts.headers, opts.mapping.payeeColumn);
  const memoIdx = columnIndex(opts.headers, opts.mapping.memoColumn);
  const catIdx = columnIndex(opts.headers, opts.mapping.categoryColumn);

  const dupCounts = new Map<string, number>();
  const out: NormalizedImportRow[] = [];

  for (let i = 0; i < opts.dataRows.length; i++) {
    const row = opts.dataRows[i]!;
    const rowNumber = opts.headerRowIndex + i + 2;
    const get = (idx: number) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");

    const dateRaw = get(dateIdx);
    const date = parseDate(dateRaw, opts.mapping.dateFormat);
    if (!date) {
      out.push({
        rowNumber,
        date: "",
        amountCents: 0,
        payee: "",
        memo: "",
        categoryId: null,
        fingerprint: "",
        error: "invalid date",
      });
      continue;
    }

    let amountCents: number | null = null;
    if (amountIdx >= 0) amountCents = parseMoney(get(amountIdx));
    else {
      const debit = debitIdx >= 0 ? parseMoney(get(debitIdx)) : null;
      const credit = creditIdx >= 0 ? parseMoney(get(creditIdx)) : null;
      if (debit != null && debit !== 0) amountCents = -Math.abs(debit);
      else if (credit != null && credit !== 0) amountCents = Math.abs(credit);
    }
    if (amountCents == null) {
      out.push({
        rowNumber,
        date,
        amountCents: 0,
        payee: "",
        memo: "",
        categoryId: null,
        fingerprint: "",
        error: "invalid amount",
      });
      continue;
    }

    if (opts.invertSign) amountCents = -amountCents;

    const payee = get(payeeIdx);
    const memo = get(memoIdx);
    let categoryId: string | null = null;
    const catName = get(catIdx);
    if (catName) categoryId = opts.categoryByName.get(catName.toLowerCase()) ?? null;
    if (!categoryId) categoryId = opts.applyPayeeRules(payee);

    const dupKey = `${date}|${amountCents}|${normalizePayee(payee)}`;
    const nth = dupCounts.get(dupKey) ?? 0;
    dupCounts.set(dupKey, nth + 1);
    const fingerprint = transactionFingerprint(opts.accountId, date, amountCents, payee, nth);

    out.push({ rowNumber, date, amountCents, payee, memo, categoryId, fingerprint });
  }
  return out;
}
