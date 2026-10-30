import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guessMapping,
  inferAmountColumnStyle,
  normalizeImportRows,
  normalizePayee,
  parseCsv,
  parseDate,
  parseMoney,
  stripBom,
  transactionFingerprint,
} from "../src/budget/csv";

test("budget csv: parses quoted fields and BOM", () => {
  const raw = stripBom('\ufeffDate,Description,Amount\n2026-01-10,"Coffee, LLC",-4.50');
  const rows = parseCsv(raw);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]![1], "Coffee, LLC");
  const mapping = guessMapping(rows[0]!);
  assert.equal(mapping.dateColumn, "Date");
  assert.equal(mapping.payeeColumn, "Description");
});

test("budget csv: nth is per file only for identical rows", () => {
  const accountId = "acct-1";
  const payee = "Same Merchant";
  const fp0 = transactionFingerprint(accountId, "2026-03-01", -999, payee, 0);
  const fp1 = transactionFingerprint(accountId, "2026-03-01", -999, payee, 1);
  assert.notEqual(fp0, fp1);
  assert.equal(normalizePayee("  Foo   Bar "), "foo bar");
});

test("budget csv: normalize assigns nth within file", () => {
  const headers = ["Date", "Amount", "Description"];
  const data = [
    ["01/15/2026", "10.00", "Duplicate"],
    ["01/15/2026", "10.00", "Duplicate"],
  ];
  const rows = normalizeImportRows({
    accountId: "a1",
    mapping: { dateColumn: "Date", dateFormat: "MM/DD/YYYY", amountColumn: "Amount", payeeColumn: "Description" },
    invertSign: true,
    headers,
    dataRows: data,
    headerRowIndex: 0,
    categoryByName: new Map(),
    applyPayeeRules: () => null,
  });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0]!.fingerprint, rows[1]!.fingerprint);
});

test("budget csv: invalid calendar dates rejected; epoch date allowed", () => {
  assert.equal(parseDate("02/31/2026", "MM/DD/YYYY"), null);
  assert.equal(parseDate("2026-02-31", "YYYY-MM-DD"), null);
  assert.equal(parseDate("1970-01-01", "YYYY-MM-DD"), "1970-01-01");
});

test("budget csv: parseMoney strict US shape and European decimals", () => {
  assert.equal(parseMoney("12,345.67"), 1_234_567);
  assert.equal(parseMoney("1,23"), 123);
  assert.equal(parseMoney("12,345"), null);
  assert.equal(parseMoney("12,345", "us"), 1_234_500);
  assert.equal(parseMoney("1,234"), null);
  assert.equal(parseMoney("1,234", "us"), 123_400);
  assert.equal(parseMoney("1234,567"), null);
  assert.equal(parseMoney("00,123"), null);
  assert.equal(parseMoney("12,34,567"), null);
});

test("budget csv: infer amount column style from column samples", () => {
  assert.equal(inferAmountColumnStyle(["1,234.56", "12,345"]), "us");
  assert.equal(parseMoney("12,345", inferAmountColumnStyle(["1,234.56", "12,345"])), 1_234_500);

  assert.equal(inferAmountColumnStyle(["12,34", "1,23"]), "european");
  assert.equal(parseMoney("1,23", inferAmountColumnStyle(["12,34", "1,23"])), 123);
  assert.equal(parseMoney("12,345", inferAmountColumnStyle(["12,34", "1,23"])), null);

  assert.equal(inferAmountColumnStyle(["12,345", "99,876"]), "unknown");
  assert.equal(parseMoney("12,345", inferAmountColumnStyle(["12,345", "99,876"])), null);
  assert.equal(inferAmountColumnStyle(["12,34,567", "1,00,000"]), "unknown");
});

test("budget csv: normalizeImportRows resolves ambiguous amounts when US column evidence exists", () => {
  const headers = ["Date", "Amount"];
  const rows = normalizeImportRows({
    accountId: "a1",
    mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD", amountColumn: "Amount" },
    invertSign: false,
    headers,
    dataRows: [
      ["2026-01-01", "12,345"],
      ["2026-01-02", "1,234.56"],
    ],
    headerRowIndex: 0,
    categoryByName: new Map(),
    applyPayeeRules: () => null,
  });
  assert.equal(rows[0]!.error, undefined);
  assert.equal(rows[0]!.amountCents, 1_234_500);
  assert.equal(rows[1]!.amountCents, 123_456);
});

test("budget csv: normalizeImportRows marks ambiguous amounts invalid without column evidence", () => {
  const headers = ["Date", "Amount"];
  const rows = normalizeImportRows({
    accountId: "a1",
    mapping: { dateColumn: "Date", dateFormat: "YYYY-MM-DD", amountColumn: "Amount" },
    invertSign: false,
    headers,
    dataRows: [
      ["2026-01-01", "12,345"],
      ["2026-01-02", "99,876"],
    ],
    headerRowIndex: 0,
    categoryByName: new Map(),
    applyPayeeRules: () => null,
  });
  assert.equal(rows[0]!.error, "invalid amount");
  assert.equal(rows[1]!.error, "invalid amount");
});

test("budget csv: parseDate accepts ISO date-times with T or space", () => {
  assert.equal(parseDate("2026-10-30T12:00:00", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-10-30T12:00:00Z", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-10-30 12:00", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-01-02 00:00:00", "YYYY-MM-DD"), "2026-01-02");
  assert.equal(parseDate("2026-10-30 10:30:00 AM", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-10-30 12:00 UTC", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-10-30 12:00:00 +0000", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-10-30  12:00", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-10-30 foo", "YYYY-MM-DD"), "2026-10-30");
  assert.equal(parseDate("2026-02-31T00:00:00", "YYYY-MM-DD"), null);
  assert.equal(parseDate("2026-10-30Tfoo", "YYYY-MM-DD"), null);
  assert.equal(parseDate("2026-10-30T", "YYYY-MM-DD"), null);
  assert.equal(parseDate("2026-10-30T25:99", "YYYY-MM-DD"), null);
  assert.equal(parseDate("10/30/2026T12:00", "MM/DD/YYYY"), null);
});

test("budget csv: parseMoney rejects ambiguous and scientific forms", () => {
  assert.equal(parseMoney("1.234"), null);
  assert.equal(parseMoney("1e3"), null);
  assert.equal(parseMoney("0x10"), null);
  assert.equal(parseMoney("1.234,56"), 123_456);
  assert.equal(parseMoney("1,234.56"), 123_456);
  assert.equal(parseMoney("1.005"), 101);
  assert.equal(parseMoney("$-5"), -500);
  assert.equal(parseMoney("-$5"), -500);
  assert.equal(parseMoney("+45.00"), 4500);
  assert.equal(parseMoney("1,234,567"), 123_456_700);
  assert.equal(parseMoney("12,34"), 1234);
});

test("budget csv: parseDate ignores trailing time", () => {
  assert.equal(parseDate("01/02/2026 10:30", "MM/DD/YYYY"), "2026-01-02");
  assert.equal(parseDate("02/01/2026 08:00", "DD/MM/YYYY"), "2026-01-02");
});

test("budget csv: credit column guess does not match Posting Date", () => {
  const headers = ["Posting Date", "Description", "Amount"];
  const mapping = guessMapping(headers);
  assert.notEqual(mapping.creditColumn, "Posting Date");
});
