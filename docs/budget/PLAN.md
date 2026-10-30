# Budget section — implementation plan

Native **Budget** in Command Center (`apps/server`, server-rendered TS UI). **CSV-only** import; no bank sync, Actual, or OFX. Money is **integer cents** in a separate **`budget.sqlite`** under `cfg.dataDir` (same `homepage-data` volume as `rss.sqlite`; add a backup bullet in `SELFHOST.md` when shipping). **Implementation PRs A/B/C start only after the UI restyle PR merges** (inset sidebar, `pageHeader`, `statCard`, `skeleton`, `badge`, `emptyState` in `apps/server/src/ui/components.ts`, `apps/server/src/ui/chart-svg.ts`). Do not open PR A until restyle is on `main`.

**Views:** `/budget?view=overview|transactions|budget|accounts|import|settings` (same query pattern as `/library?view=` in `apps/server/src/ui/sources-page.ts`).

---

## PR split (review order)

### PR A — Core, CSV import, enable gate, privacy shell

| Area | Files (new unless noted) |
|------|---------------------------|
| DB | `apps/server/src/budget/db.ts` (`BudgetStore.open`, `chmod`/`0600` on DB path after create), `migrations.ts` (numbered steps + `schema_version`), `schema.ts` (zod), `store.ts` |
| Import | `csv.ts` (RFC-4180 parser + normalize), `import-preview-cache.ts` (in-memory: key = owner email + random preview id; value = normalized rows only; 15 min TTL; delete on commit/undo; never log keys or row payloads), `redact.ts` (safe log lines) |
| HTTP | `routes.ts`, `gate.ts` (`budgetAvailable(cfg)`), wire in `apps/server/src/index.ts`, `apps/server/src/http.ts` (**before** panel loop, like board/calendar) |
| Nav | `apps/server/src/nav-tabs.ts` (`budget` tab, hidden when gate false) |
| UI (minimal) | `apps/server/src/ui/budget-page.ts` — shell + tabs + “Budget unavailable” when gate false; Accounts + Import wizard only |
| Notices | `THIRD_PARTY_NOTICES.md` — no AB text yet |

**Schema v1** (migration 1): `accounts` (`type` ∈ `checking`, `savings`, `credit`, `cash`, `investment` — **no `loan`**; **`invert_sign`** persisted per account; **`investment`** uses editable **`current_balance_cents`**, not holdings), `category_groups`, `categories`, `budget_months`, `transactions`, `import_batches`, `payee_rules`, `csv_profiles`, indexes including partial unique `(account_id, fingerprint)`. Seed default category groups on first open. **No loan tables yet.**

**Routes (all owner + gate):** `GET/POST /api/budget/*` — accounts/categories CRUD, `budget_months`, transactions CRUD, payee rules, `POST /api/budget/import/preview` (raw CSV, `readRawBody` **5 000 000** bytes from `apps/server/src/request-body.ts`), `POST /api/budget/import/commit`, `POST /api/budget/import/undo/:batchId`, import history. JSON via local helper mirroring `apps/server/src/board/routes.ts` (`cache-control: no-store`). **`GET /budget`** page route in `http.ts`.

**Auth:** `who.owner === true` only (`apps/server/src/auth.ts` — verified CF Access JWT email ∈ `cfg.ownerEmails`; reject `admin-token`, service tokens, MCP). **Do not** use `canManageSharedServerState` (`apps/server/src/owner-auth.ts`).

**Enable gate:** Budget inactive unless **`cfg.cfTeamDomain`**, **`cfg.cfAud?.length`**, and **`cfg.ownerEmails.length`** are all set (`apps/server/src/config.ts`). If false: no `BudgetStore.open`, nav entry off, APIs **503** with generic copy, page explains required env (no new secrets).

**Tests:** `apps/server/test/budget-gate.test.ts`, `budget-store.test.ts`, `budget-csv.test.ts`, `budget-import.test.ts`, `budget-privacy.test.ts` (see Privacy table).

---

### PR B — Reports, net worth (accounts), dashboard panel

| Area | Files |
|------|--------|
| Logic | `rollup.ts` (month/category spent, income vs spend, cash flow; exclude `transfer_account_id`) |
| UI | extend `budget-page.ts` — Overview, Transactions, Budget views; client fetch `/api/budget/rollup`, `/api/budget/transactions` |
| Panel | `apps/server/src/panels/budget.ts`, register in `apps/server/src/panels/registry.ts`, `panels/types.ts` (`budget?: BudgetStore`), `dashboard-layout/defaults.ts` (add panel + **`DEFAULT_COLLAPSED_PANEL_IDS`**), `apps/server/src/ui/dashboard-page.ts` if needed. **Omit panel from layout and skip `/api/panels/budget` fetch** when gate is off or `owner === false` (no placeholder copy) |
| Settings | in-page export JSON/CSV, delete-all (type-to-confirm), privacy default (**no over-budget notifications**) |
| Docs | `SELFHOST.md` — backup `budget.sqlite` |

**Net worth (PR B):** `GET /api/budget/net-worth` = sum of non-archived account balances (`checking` / `savings` / `credit` / `cash`: opening + Σ txs; **`investment`:** `current_balance_cents` only). Response/UI label includes **“Equity coming soon”** (no assets/loans yet). **PR C** replaces the headline number with **accounts + Σ latest `asset_values` − Σ loan engine principal** and drops the placeholder label when engine data exists.

**Tests:** `budget-rollup.test.ts`, `budget-routes-owner.test.ts`, `budget-panel.test.ts`, `budget-net-worth.test.ts`.

---

### PR C — Loans, assets, equity (AB engine port)

| Area | Files |
|------|--------|
| Engine | `apps/server/src/budget/loans/` — port MIT files from [AB-Asset-Tracker](https://github.com/gismc123/AB-Asset-Tracker): `amortize.ts`, `equity.ts`, `money.ts`, `dates.ts` (+ minimal `types.ts` slices). **Loans live only here** (no loan CSV import, no `loan` account type). Optional **manual balance override** on a loan record when amortization ≠ servicer statement. **Omit v1:** PMI, escrow ledger, daily-simple interest, skip/defer/catch-up, payoff quotes, `modules` toggles beyond mortgage/auto/personal label |
| DB | migration 2: `loans`, `loan_setup` (JSON), `loan_settings` (`category_id` → CC category), `loan_details`, `adjustments`, `loan_months` (`transaction_id` → `transactions`, **`ON DELETE SET NULL`**), `assets`, `asset_values` |
| HTTP | `/api/budget/loans/*`, reconcile = link `loan_months.transaction_id` to imported tx (import undo clears link, does not block delete) |
| UI | `/budget?view=loans` (or sub-routes): setup, schedule, equity, reconcile |
| Legal | `THIRD_PARTY_NOTICES.md` — Ivan Santos / MIT block for AB engine |

**Tests:** `budget-loans-engine.test.ts` (golden schedules vs AB fixtures), `budget-reconcile.test.ts`, `budget-equity.test.ts`.

---

## CSV parsing & dedupe

**Parser:** Small in-repo RFC-4180 state machine in `csv.ts` (**no new dependency**). Strip UTF-8 BOM; auto-detect header row (first row with ≥2 non-empty cells). **Generic column guess** (no bank-specific presets required): map common headers — date (`Date`, `Posted`, `Transaction Date`, …), amount (`Amount`), debit/credit pair (`Debit`/`Credit`), payee (`Description`, `Payee`, `Merchant`, …), memo (`Memo`), category (`Category`). Saved **`csv_profiles`** per account override guesses on the next import.

- **Date:** column + format enum (`MM/DD/YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`).
- **Amount:** single signed column **or** separate debit/credit columns. **Outflows are stored negative.** Each account has **`invert_sign`**; preview applies it when normalizing. For **`credit`** accounts, if most charge rows parse as positive amounts, preview **suggests** enabling invert and the user **confirms** before commit (persist choice on the account).
- **Payee**, optional memo, optional category column (name match to seeded categories). **Do not import into `investment` accounts** (manual balance only); wizard disables or rejects that account type.

**Row limits:** 5 MB file cap; reject >20 k data rows at preview.

**Fingerprint (dedupe):**  
`sha256(accountId + "|" + date + "|" + amountCents + "|" + normalizedPayee + "|" + nth)` hex, where `normalizedPayee = trim, collapse whitespace, lowercase ASCII`. **`nth`** = 0-based index among rows **in the same file only** that share the same `(accountId, date, amountCents, normalizedPayee)` (first match → 0, second → 1, …). **`nth` is not adjusted from the DB** — re-importing the same or an overlapping statement recomputes the same fingerprints, hits the unique index on `(account_id, fingerprint)`, and rows are skipped (that is the intended dedupe). Two genuinely identical same-day charges in one file get different `nth` values and **both** insert. **`budget-import.test.ts`:** commit a file, re-commit the same file and a partially overlapping file → **0 new rows** each time; one file with two identical rows → **2 rows** stored.

**Commit:** single SQLite transaction; record `import_batches` with `file_sha256` (hash of raw bytes), counts, `mapping_json`; **never** store raw CSV. Undo = delete batch → cascade transactions (`ON DELETE CASCADE`); loan reconcile rows lose `transaction_id` via **`SET NULL`** (PR C).

---

## Privacy enforcement

| Rule | Where enforced | Test |
|------|----------------|------|
| Owner-only reads/writes | `budget/routes.ts`: `requireBudgetOwner(who)` → 403 + `OWNER_ACTION_FORBIDDEN` from `owner-auth.ts`; `/budget` page omits API script for non-owner | `budget-routes-owner.test.ts` — admin-token & anonymous 403 |
| Section off without CF Access + owners | `budget/gate.ts`; `index.ts` skips store; `nav-tabs.ts` visibility | `budget-gate.test.ts` |
| No financial data in logs | `budget/routes.ts` try/catch → `redact.logBudgetError(code)` only; never log `err` from zod/parse with row payload; preview cache keys/rows never logged; `http.ts` outer catch must not run for budget paths | `budget-privacy.test.ts` — import with payee `PLANT_SECRET_PAYEE`, assert captured `console.error` lacks it |
| No budget data to LLM/MCP/webhooks/briefings | No `BudgetStore` on `IntegrationDeps` (`mcp/actions.ts`); no tools in `mcp/create-server.ts`; no imports of budget from `llm/provider.ts`, `daily-briefing/`, `briefing/shutdown-service.ts`, `integrations/power-automate.ts`, `panels/notes.ts` Q&A, `notify/` | `budget-privacy.test.ts` — snapshot MCP tool names; grep `budget/` under `mcp/` and `llm/`; where cheap, run existing briefing/MCP/LLM context builders (e.g. daily briefing payload assembly, `createCommandCenterMcp` tool list, notes Q&A context helper) with budget data seeded and assert output **does not contain** `PLANT_SECRET_PAYEE` |
| `Cache-Control: no-store` | Budget JSON helpers + `send()` for `/budget` (global `send` already sets no-store in `http.ts`) | `budget-routes-owner.test.ts` header assert |
| PWA must not cache `/budget` | `apps/server/src/pwa.ts` — extend SW `fetch` guard: skip cache when `pathname === "/budget" \|\| pathname.startsWith("/budget/")` | `budget-privacy.test.ts` — SW source contains skip |
| Dashboard amounts blurred by default | `panels/budget.ts` — CSS blur + eye toggle (`localStorage`); panel only registered/rendered for owner + gate | `budget-panel.test.ts` — owner HTML contains blur class; non-owner / gate-off layout has no `budget` panel id |

Follow **`notes/sensitive.ts`** pattern: add `apps/server/src/budget/excluded.ts` documenting “budget never in agent context” (hard rule, no opt-in LLM categorization in v1).

---

## Encryption at rest (proposal only)

**v1: disk protections only** (`0700` data dir via `store.ts` `ensureDirs`, `0600` on `budget.sqlite`, CF Access, separate file on `homepage-data`). **No encryption key in v1.** Document-only future option: AES-GCM column encryption with a **`BUDGET_ENCRYPTION_KEY`** (new secret — Kellan must approve before any env or migration; key loss = data loss). Could mirror `CONNECTIONS_MASTER_KEY` in `config.ts` when/if requested.

---

## Decisions (defaults; Kellan may override)

1. **CSV mapping:** Ship generic header auto-detection; no waiting on bank samples. Per-account **`csv_profiles`** still save the owner’s confirmed mapping.
2. **Signs:** Outflows negative; **`invert_sign`** per account. Credit-card imports: preview suggests flip when charges look mostly positive; user confirms in preview.
3. **Loans:** Loan engine only (PR C); optional manual balance override on a loan. No loan CSV import; **`loan` account type is not in PR A schema.**
4. **Investments:** **`investment`** accounts = single manual **`current_balance_cents`**; no holdings/positions import.
5. **Alerts:** No over-budget ntfy or push in v1.
6. **Net worth:** PR B = accounts total + **“Equity coming soon”**; PR C = accounts + assets − loans (full formula).
7. **Encryption:** Disk/volume/Access only for v1; keyed migration stays a written proposal only (no key).
8. **Sequencing:** Budget **code PRs A → B → C** open only **after** the restyle PR is merged to `main`.

---

## Reference paths (existing)

- SQLite pattern: `apps/server/src/board/store.ts` + `apps/server/src/database.ts` (WAL, migrations via `ALTER`); budget uses **dedicated file** + **`schema_version`** table instead of sharing `rss.sqlite`.
- Owner JWT: `apps/server/src/auth.ts` lines 40–48.
- Error logging to avoid: `apps/server/src/http.ts` ~543 `console.error("request failed:", err)`.
- Panel registration: `apps/server/src/panels/registry.ts`, collapsed defaults `apps/server/src/dashboard-layout/defaults.ts`.
- Service worker: `apps/server/src/pwa.ts` lines 71–74 (today skips only `/api/` and `/extension.zip`).
