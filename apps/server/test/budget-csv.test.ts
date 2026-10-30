import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guessMapping,
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

test("budget csv: parseMoney rejects ambiguous and scientific forms", () => {
  assert.equal(parseMoney("1.234"), null);
  assert.equal(parseMoney("1,234"), null);
  assert.equal(parseMoney("1e3"), null);
  assert.equal(parseMoney("0x10"), null);
  assert.equal(parseMoney("1.234,56"), 123_456);
  assert.equal(parseMoney("1,234.56"), 123_456);
  assert.equal(parseMoney("1.005"), 101);
});

test("budget csv: credit column guess does not match Posting Date", () => {
  const headers = ["Posting Date", "Description", "Amount"];
  const mapping = guessMapping(headers);
  assert.notEqual(mapping.creditColumn, "Posting Date");
});
