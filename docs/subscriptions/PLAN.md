# Subscriptions & recurring bills — implementation plan

**Owner-only** recurring spend tracking on top of **Budget PR A** (`budget.sqlite`, CSV import, `budgetAvailable`, `handleBudgetRoutes`). Detects recurring payees from imported transactions; Kellan confirms, dismisses, or adds manual subscriptions. Shows **annualized cost** and **next due date**. Same privacy bar as budget: no LLM, logs, push, briefing, or PWA cache.

**Out of scope:** bank sync, email triage, agent memory, automatic price negotiation, budget alert ntfy (explicitly excluded in budget v1 decisions).

**Build order:** Implementation PR **after Budget PR A** on `main`; may ship in same PR as Budget PR B if review size allows—prefer **one dedicated subscriptions PR** for clarity.

---

## Scope

| In | Out |
|----|-----|
| Tables in `budget.sqlite` (migration N) | New auth env vars |
| Detection job on import commit + manual “Scan” | Sending subscription amounts to `generateShutdownReflection` or daily briefing |
| UI tab `/budget?view=subscriptions` | Todoist / board linkage |
| Confirm / dismiss / manual CRUD | LLM categorization |

---

## Data model

Migration adds to **`budget.sqlite`** (opened via `BudgetStore.open` / `openBudgetDatabase` in `budget/db.ts`, `chmod 0600` per `docs/budget/PLAN.md`):

| Table | Columns (v1) |
|-------|----------------|
| `subscriptions` | `id`, `payee_normalized`, `display_name`, `amount_cents`, `currency`, `cadence` (`weekly` \| `monthly` \| `yearly`), `anchor_date` (YYYY-MM-DD), `category_id` nullable FK, `active`, `source` (`detected` \| `manual`), `created_at`, `updated_at` |
| `subscription_detections` | `id`, `payee_normalized`, `amount_cents`, `cadence`, `confidence`, `sample_dates_json`, `status` (`pending` \| `confirmed` \| `dismissed`), `created_at` |

Indexes: `(payee_normalized, amount_cents)`, `(status)` on detections.

**Payee normalization (reuse):** `normalizePayee` from `budget/csv.ts` — trim, collapse whitespace, lowercase ASCII (same as transaction fingerprint payee leg in `docs/budget/PLAN.md`).

---

## Detection algorithm (v1)

Run after `POST /api/budget/import/commit` (in `budget/routes.ts` transaction) and via `POST /api/budget/subscriptions/scan`:

1. **Load outflows:** transactions with `amount_cents < 0` from last **18 months**, exclude transfers (`transfer_account_id` set when PR B columns exist; v1 subscriptions PR may ship with PR A schema—then filter by category or payee rules only).
2. **Group key:** `(normalizePayee(payee), bucketAmount)` where `bucketAmount = round(abs(amount_cents) / tolerance)` and **tolerance** = max(50 cents, 1% of amount) to absorb small drift.
3. **Cadence detection** on each group with ≥3 dates (sorted):
   - Compute consecutive day gaps.
   - **Weekly:** median gap 6–8 days, stdev ≤ 1.5 days.
   - **Monthly:** median gap 27–33 days.
   - **Yearly:** median gap 350–380 days.
4. **Amount stability:** all samples within tolerance of modal amount.
5. Emit `subscription_detections` with `confidence` 0–1 (frequency regularity × amount stability). Skip groups already tied to an active `subscriptions` row or dismissed with same payee+amount.
6. **Never log** payee strings on failure—`logBudgetError` only (`budget/redact.ts`).

Kellan **confirms** → insert `subscriptions`, mark detection `confirmed`. **Dismiss** → `dismissed` (no re-suggest for 90 days unless new transactions). **Manual add** → `source=manual`, skip detection.

**Next due date:** advance `anchor_date` by cadence from last matching transaction date (or today if none). **Annual cost:** `amount_cents * {52,12,1}` by cadence (display integer cents).

---

## API routes

All under existing budget gate + `ownerOk` (`budget/routes.ts` pattern). JSON `cache-control: no-store`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/budget/subscriptions` | Active subscriptions + pending detections |
| POST | `/api/budget/subscriptions` | Manual create |
| PUT | `/api/budget/subscriptions/:id` | Edit / deactivate |
| POST | `/api/budget/subscriptions/detections/:id/confirm` | Promote detection → subscription |
| POST | `/api/budget/subscriptions/detections/:id/dismiss` | Dismiss |
| POST | `/api/budget/subscriptions/scan` | Re-run detector (idempotent) |

Non-owner / gate off: same **403/503** as budget routes; nav hidden via `nav-tabs.ts` when gate false.

---

## UI

Extend `apps/server/src/ui/budget-page.ts` (per `docs/budget/PLAN.md`):

- Tab **`subscriptions`**: list active (annual cost, next due), pending detections with Confirm/Dismiss, manual add form (`field()` from `components.ts`).
- Use `#85` `pageHeader` / `statCard` / `emptyState` patterns inside budget shell.
- No new standalone route outside `/budget`.

---

## Privacy and security

| Rule | Where | Test |
|------|-------|------|
| Owner-only | Same as budget `requireBudgetOwner` / `ownerOk` | Extend `budget-routes-owner.test.ts` |
| Gate off → 503 API, 404 page | `budgetAvailable`, `http.ts` `/budget` | `budget-gate.test.ts` |
| No payee/amount in logs | `logBudgetError` | `budget-privacy.test.ts` pattern |
| No LLM/MCP/briefing/ntfy | No imports in those trees | Grep + `budget-privacy.test.ts` style |
| PWA skip `/budget` | `pwa.ts` | SW source assert |
| Budget alerts never in briefings | No subscription fields in `buildShutdownReview` / `DailyBriefingService` | Static import grep |

---

## Tests

**Unit:** `budget-subscriptions-detect.test.ts` (synthetic tx series → cadence), `budget-subscriptions-routes.test.ts`, extend `budget-privacy.test.ts` with `PLANT_SECRET_PAYEE`.

**Browser:** extend `budget.browser.ts` or add `subscriptions.browser.ts` in dashboard-browser batch—owner sees detection row; confirm moves to active list.

---

## PR breakdown

One PR: migration, detector module `budget/subscriptions/detect.ts`, route extensions, `budget-page.ts` tab, tests.

---

## Open questions for Kellan

1. Minimum confidence threshold to show a pending detection (default 0.7)?
2. Should confirmed subscriptions link to a **budget category** automatically (match payee rules) or stay uncategorized until user picks?
3. Treat **annual memberships billed monthly** as monthly with note, or force yearly cadence only when gaps ≥ 350 days?
4. Re-scan on every import vs nightly cron only?

---

## Reference paths (existing / budget plan)

- Budget plan & gate: `docs/budget/PLAN.md`, `budget/gate.ts` `budgetAvailable`, `budget/routes.ts` `handleBudgetRoutes`, `ownerOk`.
- Payee normalize: `budget/csv.ts` `normalizePayee`.
- Store pattern: `budget/store.ts`, `board/store.ts` + `node:sqlite` `DatabaseSync`.
- Owner JWT: `auth.ts`; forbidden copy: `owner-auth.ts` `OWNER_ACTION_FORBIDDEN`.
- PWA: `pwa.ts`; page no-store: `http.ts` `send()`.
